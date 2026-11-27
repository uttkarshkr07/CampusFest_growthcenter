// "What needs attention": one ranked list built from every check the app already runs, plus unusual days.
// Each item says what happened with its numbers, whose it is, and what can be done from here.
import { actionList } from "./actions";
import { registrationAnomalies, spendOutliers, SPIKE_RULE, type SpendOutlier } from "./anomaly";
import { betTracker, VERDICT_LABEL, type TrackerValue } from "./bets";
import { flags, snapshot, tasksView } from "./metrics";
import { programView } from "./program";
import { dataQuality, qualitySummary } from "./quality";
import { ticketsAt } from "./tickets";
import { daysBetween, toMs } from "./time";
import type { Dataset, Result } from "./types";

export type Severity = "act" | "watch" | "opportunity";
export type Team = "publicity" | "events" | "sponsorship";

export interface AttentionItem {
  id: string;
  kind: "flag" | "spike" | "flatline" | "spend" | "capacity" | "bet" | "ticket" | "tasks" | "recover" | "quality";
  severity: Severity;
  /** the team whose work it is; null = everyone's */
  team: Team | null;
  title: string;
  detail: string;
  /** when it happened or was judged (IST day), for ordering */
  day: string;
  /** people affected, when the data gives a count */
  people: number | null;
  link: { target: string; id?: string; label: string } | null;
  task: { title: string; description: string; campaign_id?: string | null; owner_id?: string | null; priority: "high" | "medium" | "low" } | null;
  /** a question for the copilot, pre-filled, never sent automatically */
  ask: string;
}

const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const inr = (x: number) => `INR ${n(x)}`;
const SEV_ORDER: Record<Severity, number> = { act: 0, watch: 1, opportunity: 2 };
const KIND_ORDER: AttentionItem["kind"][] = ["capacity", "spike", "flatline", "spend", "flag", "bet", "ticket", "tasks", "recover", "quality"];

const trackerMemo = new WeakMap<Dataset, Map<string, Result<TrackerValue>>>();
/** betTracker is the slowest check; the Overview and the feed share one run per date */
export function trackerFor(data: Dataset, asOf: string): Result<TrackerValue> {
  let m = trackerMemo.get(data);
  if (!m) trackerMemo.set(data, (m = new Map()));
  let r = m.get(asOf);
  if (!r) m.set(asOf, (r = betTracker(data, asOf)));
  return r;
}

export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) =>
      SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
      (b.people ?? -1) - (a.people ?? -1) ||
      b.day.localeCompare(a.day) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.id.localeCompare(b.id),
  );
}

/** items for these teams, plus items that belong to everyone */
export const forTeams = (items: AttentionItem[], teams: readonly string[]) => items.filter((i) => i.team == null || teams.includes(i.team));

export function attention(data: Dataset, asOf: string): Result<{ asOf: string; items: AttentionItem[]; counts: Record<Severity, number> }> {
  const s = snapshot(data, asOf);
  const p = s.p;
  const owner = (cid: string | null | undefined) => (cid ? (p.campaignById.get(cid)?.owner_id ?? null) : null);
  const items: AttentionItem[] = [];

  // 1. campaign flags: each STOP on its own, the SCALE ones together
  const flagRes = flags(data, asOf).value;
  const fl = flagRes.flags;
  const scaleAt = flagRes.thresholds.scale_cost_ratio;
  const stops = fl.filter((x) => x.level === "stop");
  if (stops.length >= 3) {
    const unit = s.phase === "post-event" ? "actual attendee" : "confirmed";
    items.push({
      id: "flag-stop",
      kind: "flag",
      severity: "act",
      team: "publicity",
      title: `${stops.length} campaigns past the stop line`,
      detail: `${stops.map((f) => `${f.campaign_name} (${f.metrics.costRatio ?? "n/a"}x${f.metrics.showUpPct != null ? `, show-up ${f.metrics.showUpPct}%` : ""})`).join(", ")}. Cost per ${unit} against the blended average, stop at ${flagRes.thresholds.stop_cost_ratio}x. When most campaigns are past the line, check whether one cheap channel is pulling the blended average down.`,
      day: s.day,
      people: null,
      link: { target: "campaign", id: stops[0].campaign_id, label: "Open campaigns" },
      task: { title: `Review ${stops.length} campaigns past the stop line`, description: stops.map((f) => `${f.campaign_name}: ${f.reason}`).join(" "), priority: "high" },
      ask: `${stops.length} campaigns are past the stop line. Which should we actually cut, and is the blended average itself misleading?`,
    });
  }
  for (const f of stops.length >= 3 ? [] : stops)
    items.push({
      id: `flag-${f.campaign_id}`,
      kind: "flag",
      severity: "act",
      team: "publicity",
      title: `${f.campaign_name}: stop or rework`,
      detail: f.reason,
      day: s.day,
      people: null,
      link: { target: "campaign", id: f.campaign_id, label: "Open campaign" },
      task: { title: `Stop or rework: ${f.campaign_name}`, description: f.reason, campaign_id: f.campaign_id, owner_id: owner(f.campaign_id), priority: "high" },
      ask: `Why is ${f.campaign_name} flagged STOP, and what would moving part of its budget do?`,
    });
  const scale = fl.filter((x) => x.level === "scale");
  if (scale.length) {
    const names = scale.map((f) => `${f.campaign_name} (${f.metrics.costRatio}x)`).join(", ");
    const post = s.phase === "post-event";
    items.push({
      id: "flag-scale",
      kind: "flag",
      severity: "opportunity",
      team: "publicity",
      title: `${scale.length} campaign${scale.length === 1 ? "" : "s"} with room to scale`,
      detail: `${names}. Each costs at most ${scaleAt}x the blended cost per ${post ? "actual attendee" : "confirmed"} (scale line in Settings). Scale means test more budget: channels saturate.`,
      day: s.day,
      people: null,
      link: { target: "campaign", id: scale[0].campaign_id, label: "Open campaigns" },
      task: { title: `Test more budget on: ${scale.map((f) => f.campaign_name).join(", ")}`, description: scale.map((f) => `${f.campaign_name}: ${f.reason}`).join(" "), priority: "medium" },
      ask: `Which of ${scale.map((f) => f.campaign_name).join(", ")} should get more budget first, and how much before it stops paying off?`,
    });
  }

  // 2. unusual registration days
  const { episodes, flatlines } = registrationAnomalies(data, asOf);
  for (const e of episodes) {
    const age = daysBetween(e.to, s.day);
    const f = e.followUp;
    const weakCohort = f && f.cohort >= 20 && ((f.restConfirmedPct >= 10 && f.cohortConfirmedPct < f.restConfirmedPct / 2) || f.cohortCancelledPct >= f.restCancelledPct + 30);
    if (age > 14 && !weakCohort) continue;
    const when = e.from === e.to ? e.from : `${e.from} to ${e.to}`;
    const follow = f
      ? ` Since then, ${f.cohortConfirmedPct}% of them are confirmed and ${f.cohortCancelledPct}% cancelled, against ${f.restConfirmedPct}% and ${f.restCancelledPct}% for the campaign's other sign-ups.`
      : " Too recent to see whether these people confirm.";
    items.push({
      id: `spike-${e.campaign_id}-${e.from}`,
      kind: "spike",
      severity: weakCohort ? "act" : "watch",
      team: "publicity",
      title: weakCohort ? `${e.campaign_name}: a sign-up spike that did not convert` : `${e.campaign_name}: unusual sign-up spike`,
      detail: `${n(e.count)} registrations on ${when} (peak ${n(e.peak.count)} on ${e.peak.day}) against a usual ${n(e.usual)} a day.${follow}`,
      day: e.to,
      people: e.count,
      link: { target: "campaign", id: e.campaign_id, label: "Open campaign" },
      task: {
        title: `Check sign-up quality: ${e.campaign_name}, ${when}`,
        description: `${n(e.count)} registrations against a usual ${n(e.usual)} a day.${follow} Check the source (bots, a shared link, a form error) before counting them.`,
        campaign_id: e.campaign_id,
        owner_id: owner(e.campaign_id),
        priority: weakCohort ? "high" : "medium",
      },
      ask: `What happened with ${e.campaign_name} registrations on ${when}? Compare those people with the campaign's other sign-ups.`,
    });
  }
  for (const fl of flatlines)
    items.push({
      id: `flat-${fl.campaign_id}`,
      kind: "flatline",
      severity: "watch",
      team: "publicity",
      title: `${fl.campaign_name}: sign-ups stopped`,
      detail: `No registrations for ${fl.zeroDays} days (since ${fl.zeroSince}), after a usual ${n(fl.usual)} a day. The campaign is still active.`,
      day: s.day,
      people: null,
      link: { target: "daily_marketing", id: fl.campaign_id, label: "Daily rows" },
      task: { title: `Find out why ${fl.campaign_name} stopped bringing sign-ups`, description: `0 registrations since ${fl.zeroSince}; usual ${n(fl.usual)} a day.`, campaign_id: fl.campaign_id, owner_id: owner(fl.campaign_id), priority: "medium" },
      ask: `${fl.campaign_name} has had no registrations since ${fl.zeroSince}. What else changed for it?`,
    });

  // 3. unusual spend rows
  // consecutive unusual days of one campaign become one item
  const runs: SpendOutlier[][] = [];
  for (const o of [...spendOutliers(data, asOf)].sort((a, b) => a.campaign_id.localeCompare(b.campaign_id) || a.day.localeCompare(b.day))) {
    const last = runs[runs.length - 1]?.at(-1);
    if (last && last.campaign_id === o.campaign_id && daysBetween(last.day, o.day) <= 1) runs[runs.length - 1].push(o);
    else runs.push([o]);
  }
  runs.sort((a, b) => Math.max(...b.map((x) => x.multiple)) - Math.max(...a.map((x) => x.multiple)));
  for (const run of runs.slice(0, 3)) {
    if (run.length > 1) {
      const top = run.reduce((a, b) => (b.multiple > a.multiple ? b : a));
      const total = run.reduce((a, x) => a + x.spend, 0);
      const when = `${run[0].day} to ${run.at(-1)!.day}`;
      items.push({
        id: `spend-${run[0].activity_id}`,
        kind: "spend",
        severity: top.multiple >= 10 ? "act" : "watch",
        team: "publicity",
        title: `${top.campaign_name}: unusual spend on ${run.length} days in a row`,
        detail: `${inr(total)} from ${when}, up to ${top.multiple}x a usual day of ${inr(top.usual)} (rows ${run.map((x) => x.activity_id).join(", ")}). Check what bought it before trusting this campaign's cost per person.`,
        day: run.at(-1)!.day,
        people: null,
        link: { target: "daily_marketing", id: top.campaign_id, label: "Open the rows" },
        task: { title: `Check spend ${when} (${top.campaign_name})`, description: `${inr(total)} over ${run.length} days, up to ${top.multiple}x the usual ${inr(top.usual)}.`, campaign_id: top.campaign_id, owner_id: owner(top.campaign_id), priority: top.multiple >= 10 ? "high" : "medium" },
        ask: `Why did ${top.campaign_name} spend ${inr(total)} from ${when}, and what did it bring in?`,
      });
      continue;
    }
    const o = run[0];
    items.push({
      id: `spend-${o.activity_id}`,
      kind: "spend",
      severity: o.multiple >= 10 ? "act" : "watch",
      team: "publicity",
      title: `${o.campaign_name}: spend on ${o.day} is ${o.multiple}x a usual day`,
      detail: `${inr(o.spend)} against a usual ${inr(o.usual)} (row ${o.activity_id}). If it is an entry error, every cost per person for this campaign is off.`,
      day: o.day,
      people: null,
      link: { target: "daily_marketing", id: o.activity_id, label: "Open the row" },
      task: { title: `Check spend row ${o.activity_id} (${o.campaign_name})`, description: `${inr(o.spend)} on ${o.day}, ${o.multiple}x the usual ${inr(o.usual)}.`, campaign_id: o.campaign_id, owner_id: owner(o.campaign_id), priority: o.multiple >= 10 ? "high" : "medium" },
      ask: `Is the ${o.campaign_name} spend on ${o.day} (${inr(o.spend)}) unusual, and how does it change its cost per person?`,
    });
  }

  // 4. capacity
  const prog = programView(data, asOf).value;
  if (prog.hasBookings) {
    const sessions = prog.venues.flatMap((v) => v.sessions.map((x) => ({ ...x, venue: v.name })));
    const full = sessions
      .filter((x) => x.booking && x.seatsOffered && toMs(x.startsAt) > s.asOfMs)
      .map((x) => ({ ...x, fill: x.booking!.booked / x.seatsOffered! }))
      .filter((x) => x.fill >= 0.9)
      .sort((a, b) => b.fill - a.fill)
      .slice(0, 4);
    for (const x of full) {
      const over = x.booking!.booked > x.seatsOffered!;
      items.push({
        id: `cap-${x.event_id}`,
        kind: "capacity",
        severity: over ? "act" : "watch",
        team: "events",
        title: over ? `${x.name}: booked above its seats` : `${x.name}: ${Math.round(x.fill * 100)}% booked`,
        detail: `${n(x.booking!.booked)} bookings for ${n(x.seatsOffered!)} seats in ${x.venue}, ${x.day}${x.booking!.waiting ? `; ${n(x.booking!.waiting)} on the waitlist` : ""}.`,
        day: s.day,
        people: over ? x.booking!.booked - x.seatsOffered! : x.booking!.waiting || null,
        link: { target: "event", id: x.event_id, label: "Open on the map" },
        task: { title: `${over ? "Resolve overbooking" : "Plan the waitlist"}: ${x.name}`, description: `${n(x.booking!.booked)} booked for ${n(x.seatsOffered!)} seats (${x.venue}, ${x.day}).`, priority: over ? "high" : "medium" },
        ask: `How full is ${x.name}, and what happens to its waitlist?`,
      });
    }
  }

  // 5. bets judged Change or Stop
  const tr = trackerFor(data, asOf).value;
  if (tr.hasBetData) {
    for (const card of [...tr.bets, tr.plan])
      for (const k of card.kpis) {
        if (k.verdict !== "stop" && k.verdict !== "change") continue;
        const t = k.threshold;
        const rule = t && t.scaleAt != null && t.stopAt != null ? ` Scale at ${t.direction === "lower" ? "<=" : ">="} ${t.scaleAt}, stop ${t.direction === "lower" ? "above" : "below"} ${t.stopAt}.` : "";
        items.push({
          id: `bet-${card.bet_id}-${k.id}`,
          kind: "bet",
          severity: k.verdict === "stop" ? "act" : "watch",
          team: (card.ownerTeam as Team | null) ?? null,
          title: `${card.name}: ${k.name} says ${VERDICT_LABEL[k.verdict]}`,
          detail: `${k.display}, judged on ${k.judgedOn}.${rule}${k.action ? ` Planned action: ${k.action}` : ""}`,
          day: k.judgedOn,
          people: null,
          link: { target: "bet", id: card.bet_id, label: "Open bet" },
          task: { title: `${VERDICT_LABEL[k.verdict]}: ${k.name} (${card.name})`, description: `${k.display}, judged on ${k.judgedOn}.${rule}${k.action ? ` Planned action: ${k.action}` : ""}`, priority: k.verdict === "stop" ? "high" : "medium" },
          ask: `${k.name} for ${card.name} is at ${VERDICT_LABEL[k.verdict]}. What is driving it and what should we do?`,
        });
      }
  }

  // 6. tickets and tasks
  for (const t of ticketsAt(data, asOf)) {
    if (t.finished) continue;
    const waiting = t.status === "open";
    if (!waiting && !t.overdue) continue;
    items.push({
      id: `ticket-${t.id}`,
      kind: "ticket",
      severity: t.overdue ? "act" : "watch",
      team: t.to_team as Team,
      title: waiting ? `Ticket waiting for ${t.to_team}: ${t.title}` : `Ticket overdue: ${t.title}`,
      detail: `From ${t.from_team}, raised ${String(t.raised_on).slice(0, 10)}${t.needed_by ? `, needed by ${String(t.needed_by).slice(0, 10)}` : ""}. Status: ${t.status.replace("_", " ")}.`,
      day: String(t.raised_on).slice(0, 10),
      people: null,
      link: { target: "ticket", id: String(t.id), label: "Open ticket" },
      task: null,
      ask: `What is ticket "${t.title}" about and what does it need from ${t.to_team}?`,
    });
  }
  const tv = tasksView(data, asOf).value;
  const teamOf = new Map((data.team ?? []).map((m) => [m.owner_id, m.team]));
  const byTeam = new Map<string, { overdue: number; blocked: number }>();
  for (const t of tv.rows) {
    if (t.status === "done") continue;
    if (!t.overdue && t.status !== "blocked") continue;
    const team = (t.owner_id ? teamOf.get(t.owner_id) : null) ?? "unassigned";
    const b = byTeam.get(team) ?? { overdue: 0, blocked: 0 };
    if (t.overdue) b.overdue++;
    if (t.status === "blocked") b.blocked++;
    byTeam.set(team, b);
  }
  for (const [team, b] of byTeam)
    items.push({
      id: `tasks-${team}`,
      kind: "tasks",
      severity: b.overdue ? "act" : "watch",
      team: team === "unassigned" ? null : (team as Team),
      title: `${team === "unassigned" ? "Unassigned" : team[0].toUpperCase() + team.slice(1)} tasks: ${[b.overdue ? `${b.overdue} overdue` : "", b.blocked ? `${b.blocked} blocked` : ""].filter(Boolean).join(", ")}`,
      detail: "Overdue = not done and due before the selected date.",
      day: s.day,
      people: null,
      link: { target: "task", label: "Open tasks" },
      task: null,
      ask: `Which ${team} tasks are overdue or blocked, and which matter most for attendance?`,
    });

  // 7. people we can still act on
  const groups = actionList(data, asOf).value.groups;
  const g = (k: string) => groups.find((x) => x.cohort === k);
  const recover = s.phase === "pre-event" ? ["interested_not_confirmed", "waitlisted"] : s.phase === "live" ? ["gate_failed_not_admitted"] : [];
  for (const k of recover) {
    const x = g(k);
    if (!x || x.count === 0) continue;
    const gate = k === "gate_failed_not_admitted";
    items.push({
      id: `recover-${k}`,
      kind: "recover",
      severity: gate ? "act" : "opportunity",
      team: gate ? "events" : "publicity",
      title: `${n(x.count)} people: ${x.label.toLowerCase()}`,
      detail: `${x.definition}${x.byCampaign[0] ? ` Largest group: ${x.byCampaign[0].campaign_name} (${n(x.byCampaign[0].count)}).` : ""} A count, not a promise: the data does not show how many would come if contacted.`,
      day: s.day,
      people: x.count,
      link: { target: "actions", id: k, label: "See the list" },
      task: { title: `Follow up: ${x.label.toLowerCase()} (${n(x.count)})`, description: x.definition, priority: gate ? "high" : "medium" },
      ask: `Who is in "${x.label}", and which of them should we contact first?`,
    });
  }

  // 8. data problems that change counts
  const q = qualitySummary(dataQuality(data)).filter((x) => x.effect === "excluded" || x.effect === "check");
  if (q.length) {
    const records = q.reduce((a, x) => a + x.records, 0);
    items.push({
      id: "quality",
      kind: "quality",
      severity: "watch",
      team: null,
      title: `Data: ${n(records)} record${records === 1 ? "" : "s"} left out or worth a check`,
      detail: q.slice(0, 3).map((x) => `${x.issue} (${n(x.records)})`).join("; ") + (q.length > 3 ? `; and ${q.length - 3} more kinds` : "") + ". Applies to the whole loaded dataset.",
      day: s.day,
      people: null,
      link: { target: "data_quality", label: "Data quality" },
      task: null,
      ask: "Which data problems change the counts, and by how much?",
    });
  }

  const ranked = rankAttention(items);
  const counts = { act: 0, watch: 0, opportunity: 0 } as Record<Severity, number>;
  for (const i of ranked) counts[i.severity]++;
  return {
    value: { asOf: s.label, items: ranked, counts },
    basis: [
      `Spike = a campaign day with at least ${SPIKE_RULE.minCount} registrations, ${SPIKE_RULE.multiple}x the median of its previous ${SPIKE_RULE.window} days and a robust z-score of ${SPIKE_RULE.minZ} or more, when the campaign had sign-ups on at least ${SPIKE_RULE.minActiveDays} of those days.`,
      "Spike follow-up (7+ days later): flagged Act when those people confirm at under half the rate of the campaign's other sign-ups, or cancel 30+ points more often.",
      "Sign-ups stopped = 3+ days with none, after a usual 5+ a day, on a campaign not paused or ended.",
      "Unusual spend = one day at 4x the campaign's median day and INR 5,000 above it.",
      "Other items come from the campaign flags, the bet tracker, tickets, tasks, the Actions lists and the data-quality checks.",
      "Order: Act, Watch, Opportunity; then people affected; then the most recent.",
    ],
    caveats: ["An unusual day is a reason to look, not proof of a problem. Thresholds are ASSUMPTIONS."],
  };
}
