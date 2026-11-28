import { prepare, type Prepared, type WithMs } from "./prepare";
import type { Dataset, HistoryRow, RegistrationRow, Result, TaskRow } from "./types";
import { addDays, daysBetween, endOfIstDay, istDay, resolveAsOf, toMs } from "./time";
import { countsAsAdmission } from "./prepare";
import { dayBy, numberOf, text } from "./betview";
import { dataQuality, qualitySummary } from "./quality";

// ---------------------------------------------------------------------------
// Shared vocabulary (used in basis strings so every answer cites its rules)
// ---------------------------------------------------------------------------
export const DEF = {
  asOf: "As-of = end of the selected day in IST; every table is filtered to rows at or before it (no later outcome leaks in).",
  dedup: "Rows with identical stable IDs (activity_id, interaction_id, history_id, event_id) are import copies and count once.",
  attendee:
    "Actual attendee = distinct person_id with person_type 'external' and at least one check-in where result = 'admitted' AND verification = 'verified'. Walk-ins without a registration count; denied, pending, unverified and internal/staff/test records do not.",
  identified: "Identified external people = distinct external person_id with first_seen_at at or before as-of.",
  registered: "Registered = distinct external person_id with a registration created at or before as-of (any later status).",
  status: "Registration status = latest registration_history version at or before the snapshot time, per registration_id (histories are full-state; never summed).",
  attribution:
    "Attribution = the registration's campaign_id (recorded acquisition source). Attendees without a registration are 'Unattributed (walk-in)'. Identified people use first_campaign_id.",
  spend: "Spend = sum of net marketing_spend_inr (debit minus credit; negatives are vendor credits) for activity dates at or before as-of.",
  anonymous: "Impressions, reach, clicks, sessions and registration starts are anonymous event counts, never people.",
  showup: "Show-up = actual attendees / registered people, per acquisition campaign.",
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export type Phase = "pre-event" | "live" | "post-event";

// ---------------------------------------------------------------------------
// Snapshot: the per-as-of core sets, memoised per prepared dataset
// ---------------------------------------------------------------------------
export interface Snapshot {
  p: Prepared;
  asOfMs: number;
  day: string;
  label: string;
  phase: Phase;
  statusMs: number; // min(asOf, event start): the "confirmed at event start" snapshot after the event begins
  isExternal: (pid: string) => boolean;
  identifiedExternal: string[];
  regsAsOf: WithMs<RegistrationRow>[];
  /** external person -> their earliest registration at or before as-of */
  personReg: Map<string, WithMs<RegistrationRow>>;
  statusOf: (regId: string, atMs: number) => WithMs<HistoryRow> | null;
  attendees: Set<string>;
  registeredAttendees: Set<string>;
  walkIns: Set<string>;
  campaignOfPerson: (pid: string) => string | null; // acquisition campaign via registration
  questionAskers: Set<string>;
}

const snapCache = new WeakMap<Prepared, Map<number, Snapshot>>();

export function snapshot(data: Dataset, asOf: string): Snapshot {
  const p = prepare(data);
  const { ms: asOfMs, day, label } = resolveAsOf(asOf);
  let m = snapCache.get(p);
  if (!m) snapCache.set(p, (m = new Map()));
  const hit = m.get(asOfMs);
  if (hit) return hit;

  const phase: Phase = asOfMs < p.event.startMs ? "pre-event" : asOfMs < p.event.endMs ? "live" : "post-event";
  const isExternal = (pid: string) => p.personById.get(pid)?.person_type === "external";
  const identifiedExternal = p.people.filter((x) => x.person_type === "external" && x.ms <= asOfMs).map((x) => x.person_id);

  const regsAsOf = p.registrations.filter((r) => r.ms <= asOfMs);
  const personReg = new Map<string, WithMs<RegistrationRow>>();
  for (const r of regsAsOf) {
    if (!isExternal(r.person_id)) continue;
    const prev = personReg.get(r.person_id);
    if (!prev || r.ms < prev.ms) personReg.set(r.person_id, r);
  }

  const statusOf = (regId: string, atMs: number) => {
    const hs = p.historyByReg.get(regId);
    if (!hs) return null;
    let best: WithMs<HistoryRow> | null = null;
    for (const h of hs) if (h.ms <= atMs) best = h; // sorted by time then history_id
    return best;
  };

  const attendees = new Set<string>();
  for (const c of p.checkins) {
    if (c.ms > asOfMs) continue;
    if (!countsAsAdmission(c)) continue;
    if (!isExternal(c.person_id)) continue;
    attendees.add(c.person_id);
  }
  const registeredAttendees = new Set<string>();
  const walkIns = new Set<string>();
  for (const pid of attendees) (personReg.has(pid) ? registeredAttendees : walkIns).add(pid);

  const questionAskers = new Set<string>();
  for (const i of p.interactions) if (i.ms <= asOfMs && i.event_type === "event_question_submitted") questionAskers.add(i.person_id);

  const snap: Snapshot = {
    p,
    asOfMs,
    day,
    label,
    phase,
    statusMs: Math.min(asOfMs, p.event.startMs),
    isExternal,
    identifiedExternal,
    regsAsOf,
    personReg,
    statusOf,
    attendees,
    registeredAttendees,
    walkIns,
    campaignOfPerson: (pid) => personReg.get(pid)?.campaign_id ?? null,
    questionAskers,
  };
  m.set(asOfMs, snap);
  return snap;
}

export function baseCaveats(s: Snapshot): string[] {
  const c = [...s.p.warnings];
  if (s.phase === "live") c.push("The event is in progress at this as-of time: attendance is partial.");
  return c;
}

export function spendAsOf(s: Snapshot, campaignId?: string): number {
  let t = 0;
  for (const d of s.p.daily) {
    if (d.ms > s.asOfMs) continue;
    if (campaignId && d.campaign_id !== campaignId) continue;
    t += Number(d.marketing_spend_inr ?? 0);
  }
  return t;
}

/**
 * Bets whose operating money belongs to one sign-up route, so it counts as that campaign's cost (simulated run design:
 * C08 is the contingent route of bet B1, C10 the hackathon page of bet B5). The other bets act on every campaign's
 * registrants, so their spend stays at plan level (bet tracker).
 */
export const BET_CAMPAIGN: Readonly<Record<string, string>> = { B1: "C08", B5: "C10" };

/** Bet operating spend booked to one campaign up to as-of (same day rule as daily marketing rows; the last row per spend_id wins). */
export function betSpendAsOf(data: Dataset, asOfMs: number, campaignId: string): number {
  const rows = new Map<string, Record<string, unknown>>();
  (data.bets?.bet_spend ?? []).forEach((r, i) => {
    if (!r._deleted) rows.set(text(r.spend_id) || `#${i}`, r);
  });
  let t = 0;
  for (const r of rows.values()) if (BET_CAMPAIGN[text(r.bet_id)] === campaignId && dayBy(r.spent_on, asOfMs)) t += numberOf(r.amount_inr);
  return t;
}

function targetInForce(p: Prepared, ms: number) {
  let t = null as (typeof p.targets)[number] | null;
  for (const x of p.targets) if (x.ms <= ms) t = x;
  return t;
}

/** Status counts for external registrations (one per person) at the status snapshot time. */
export function externalStatusCounts(s: Snapshot, atMs = s.statusMs) {
  const counts: Record<string, number> = { interested: 0, confirmed: 0, cancelled: 0, waitlisted: 0, no_status: 0 };
  const confirmed = new Set<string>();
  for (const [pid, reg] of s.personReg) {
    const h = s.statusOf(reg.registration_id, atMs);
    const st = h?.status ?? "no_status";
    counts[st] = (counts[st] ?? 0) + 1;
    if (st === "confirmed") confirmed.add(pid);
  }
  return { counts, confirmed };
}

// ---------------------------------------------------------------------------
// Public engine functions
// ---------------------------------------------------------------------------

export function registrationStatus(data: Dataset, asOf: string, opts: { scope?: "external" | "all" } = {}): Result<{
  snapshotAt: string;
  scope: "external" | "all";
  counts: Record<string, number>;
  total: number;
}> {
  const s = snapshot(data, asOf);
  const scope = opts.scope ?? "external";
  const counts: Record<string, number> = { interested: 0, confirmed: 0, cancelled: 0, waitlisted: 0, no_status: 0 };
  let total = 0;
  for (const r of s.regsAsOf) {
    if (scope === "external" && !s.isExternal(r.person_id)) continue;
    const st = s.statusOf(r.registration_id, s.asOfMs)?.status ?? "no_status";
    counts[st] = (counts[st] ?? 0) + 1;
    total++;
  }
  return {
    value: { snapshotAt: s.label, scope, counts, total },
    basis: [DEF.asOf, DEF.dedup, DEF.status, scope === "external" ? "Scope: registrations of external people only." : "Scope: ALL registrations, including internal people."],
    caveats: baseCaveats(s),
  };
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  definition: string;
}

/**
 * The registration funnel. With `campaignId`, identified people are those whose first campaign it is and the
 * later stages are people whose registration it is (the same split as campaignTable); walk-ins are left out.
 */
export function funnel(data: Dataset, asOf: string, opts: { campaignId?: string } = {}) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const cid = opts.campaignId;
  const identifiedList = cid ? s.identifiedExternal.filter((pid) => p.personById.get(pid)?.first_campaign_id === cid) : s.identifiedExternal;
  const regPids = cid ? [...s.personReg].filter(([, r]) => r.campaign_id === cid).map(([pid]) => pid) : [...s.personReg.keys()];
  const regSet = new Set(regPids);
  const identified = identifiedList.length;
  const identifiedSet = new Set(identifiedList);
  const started = new Set<string>();
  for (const i of p.interactions)
    if (i.ms <= s.asOfMs && i.event_type === "registration_start" && identifiedSet.has(i.person_id)) started.add(i.person_id);
  for (const pid of regPids) started.add(pid);
  const all = externalStatusCounts(s);
  let { counts, confirmed } = all;
  if (cid) {
    counts = { interested: 0, confirmed: 0, cancelled: 0, waitlisted: 0, no_status: 0 };
    confirmed = new Set<string>();
    for (const pid of regPids) {
      const st = s.statusOf(s.personReg.get(pid)!.registration_id, s.statusMs)?.status ?? "no_status";
      counts[st] = (counts[st] ?? 0) + 1;
      if (st === "confirmed") confirmed.add(pid);
    }
  }
  const regAttendees = cid ? [...s.registeredAttendees].filter((pid) => regSet.has(pid)).length : s.registeredAttendees.size;
  const stages: FunnelStage[] = [
    { key: "identified", label: "Identified", count: identified, definition: cid ? `${DEF.identified} Only people whose first campaign is ${cid}.` : DEF.identified },
    { key: "started", label: "Started registration", count: started.size, definition: "Identified external people with an identified registration_start action, or a registration, at or before as-of." },
    { key: "registered", label: "Registered", count: regSet.size, definition: cid ? `${DEF.registered} Only registrations through ${cid}.` : DEF.registered },
    {
      key: "confirmed",
      label: s.phase === "pre-event" ? "Confirmed (now)" : "Confirmed at event start",
      count: counts.confirmed,
      definition: "Registered external people whose latest status is 'confirmed' at the snapshot time (as-of, or the event start once the event has begun).",
    },
  ];
  let noShows: number | null = null;
  if (s.phase !== "pre-event") {
    stages.push({ key: "attended", label: "Attended (registered)", count: regAttendees, definition: DEF.attendee + " Registered attendees only; walk-ins are reported separately." });
    noShows = [...confirmed].filter((pid) => !s.attendees.has(pid)).length;
  }
  let leak: { from: string; to: string; lost: number; conversion: number } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const lost = stages[i - 1].count - stages[i].count;
    if (!leak || lost > leak.lost)
      leak = { from: stages[i - 1].label, to: stages[i].label, lost, conversion: r1((stages[i].count / Math.max(1, stages[i - 1].count)) * 100) };
  }
  const caveats = baseCaveats(s);
  if (s.phase === "pre-event") caveats.push("Before the event there is no attendance yet; see projection for the expected outcome.");
  if (cid) caveats.push("Walk-ins have no campaign, so a single campaign's funnel leaves them out.");
  return {
    value: {
      asOf: s.label,
      phase: s.phase,
      campaignId: cid ?? null,
      stages,
      walkIns: s.phase === "pre-event" || cid ? 0 : s.walkIns.size,
      actualAttendees: cid ? regAttendees : s.attendees.size,
      statusAtSnapshot: counts,
      confirmedNoShows: noShows,
      biggestLeak: leak,
    },
    basis: [DEF.asOf, DEF.dedup, DEF.identified, DEF.registered, DEF.status, DEF.attendee],
    caveats,
  } satisfies Result<unknown>;
}

export function targetsVsActuals(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const t = targetInForce(s.p, s.asOfMs);
  const spend = spendAsOf(s);
  const caveats = baseCaveats(s);
  if (!t) caveats.push("No target version was in force at this as-of time.");
  const proj = s.phase === "pre-event" ? projection(data, asOf).value : null;
  const visitorsActual = s.phase === "pre-event" ? null : s.attendees.size;
  const visitorsShown = visitorsActual ?? proj?.mid ?? 0;
  const pct = (a: number, g: number | undefined) => (g ? r1((a / g) * 100) : null);
  const rows = [
    { key: "identified", label: "Identified external people", goal: t?.identified_external_people_goal ?? null, actual: s.identifiedExternal.length, projected: false },
    { key: "registered", label: "Registered external people", goal: t?.registration_goal ?? null, actual: s.personReg.size, projected: false },
    { key: "visitors", label: s.phase === "pre-event" ? "Projected verified visitors (mid case)" : "Verified external visitors", goal: t?.unique_external_visitors_goal ?? null, actual: visitorsShown, projected: s.phase === "pre-event" },
    { key: "spend", label: "Marketing spend vs budget", goal: t?.marketing_budget_inr ?? null, actual: spend, projected: false },
  ].map((r) => ({ ...r, pctOfGoal: pct(r.actual, r.goal ?? undefined), gap: r.goal != null ? r.goal - r.actual : null }));
  if (s.phase === "pre-event") caveats.push("Visitors row is a PROJECTION built on assumptions from Settings, not an actual.");
  return {
    value: {
      asOf: s.label,
      phase: s.phase,
      targetVersion: t ? { name: t.target_version, effectiveAt: t.effective_at } : null,
      rows,
      budgetRemaining: t ? t.marketing_budget_inr - spend : null,
    },
    basis: [DEF.asOf, "Target in force = the latest targets row with effective_at at or before as-of (versions are never merged).", DEF.identified, DEF.registered, DEF.attendee, DEF.spend],
    caveats,
  } satisfies Result<unknown>;
}

export interface CampaignMetrics {
  campaign_id: string;
  campaign_name: string;
  channel: string | null;
  owner_name: string | null;
  owner_id: string | null;
  source: string;
  app_status: string;
  budget_inr: number | null;
  /** net marketing spend (daily marketing rows) */
  spend: number;
  /** operating spend of a bet tied to this campaign (BET_CAMPAIGN); 0 for every other campaign */
  betSpend: number;
  /** spend + betSpend: the cost behind every INR-per-person figure */
  cost: number;
  identified: number;
  registered: number;
  confirmed: number;
  attended: number | null;
  showUpPct: number | null;
  inrPerRegistration: number | null;
  inrPerConfirmed: number | null;
  inrPerAttendee: number | null;
  shareOfSpendPct: number | null;
  shareOfAttendeesPct: number | null;
  engagedSharePct: number | null; // share of registrants who submitted a question
  budgetUsedPct: number | null;
}

export function campaignTable(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const plan = new Map((data.campaign_plan ?? []).map((c) => [c.campaign_id, c]));
  const { confirmed } = externalStatusCounts(s);
  const live = p.campaigns.filter((c) => !Number.isFinite(c.ms) || c.ms <= s.asOfMs);
  const hidden = p.campaigns.length - live.length;

  const totalSpend = spendAsOf(s);
  const betCost = new Map(live.map((c) => [c.campaign_id, betSpendAsOf(data, s.asOfMs, c.campaign_id)]));
  const totalBetSpend = [...betCost.values()].reduce((a, b) => a + b, 0);
  const totalCost = totalSpend + totalBetSpend;
  const rows: CampaignMetrics[] = live.map((c) => {
    const id = c.campaign_id;
    const spend = spendAsOf(s, id);
    const betSpend = betCost.get(id) ?? 0;
    const cost = spend + betSpend;
    const identified = s.identifiedExternal.filter((pid) => p.personById.get(pid)?.first_campaign_id === id).length;
    let registered = 0,
      conf = 0,
      att = 0,
      engaged = 0;
    for (const [pid, reg] of s.personReg) {
      if (reg.campaign_id !== id) continue;
      registered++;
      if (confirmed.has(pid)) conf++;
      if (s.attendees.has(pid)) att++;
      if (s.questionAskers.has(pid)) engaged++;
    }
    const pl = plan.get(id);
    const attended = s.phase === "pre-event" ? null : att;
    return {
      campaign_id: id,
      campaign_name: c.campaign_name,
      channel: c.channel,
      owner_name: c.owner_name,
      owner_id: c.owner_id,
      source: c._source ?? "original",
      app_status: pl?.app_status ?? "active",
      budget_inr: pl?.budget_inr ?? null,
      spend,
      betSpend,
      cost,
      identified,
      registered,
      confirmed: conf,
      attended,
      showUpPct: attended != null && registered ? r1((attended / registered) * 100) : null,
      inrPerRegistration: registered ? Math.round(cost / registered) : null,
      inrPerConfirmed: conf ? Math.round(cost / conf) : null,
      inrPerAttendee: attended ? Math.round(cost / attended) : null,
      shareOfSpendPct: totalCost ? r1((cost / totalCost) * 100) : null,
      shareOfAttendeesPct: null,
      engagedSharePct: registered ? r1((engaged / registered) * 100) : null,
      budgetUsedPct: pl?.budget_inr ? r1((spend / pl.budget_inr) * 100) : null,
    };
  });
  const attributedAttendees = rows.reduce((a, r) => a + (r.attended ?? 0), 0);
  for (const r of rows) r.shareOfAttendeesPct = r.attended != null && attributedAttendees ? r1((r.attended / attributedAttendees) * 100) : null;

  const regAttendeesNoCampaign = [...s.registeredAttendees].filter((pid) => !s.personReg.get(pid)?.campaign_id).length;
  const totalRegistered = rows.reduce((a, r) => a + r.registered, 0);
  const caveats = baseCaveats(s);
  if (hidden) caveats.push(`${hidden} campaign(s) created after this as-of date are hidden.`);
  caveats.push("Campaign costs come from net ledger spend only (no staff time or sponsor in-kind). Spend does not prove incremental attendance.");
  if (totalBetSpend)
    caveats.push(
      `Cost per person for ${[...betCost].filter(([, v]) => v).map(([k]) => k).join(" and ")} includes its bet's operating spend (${Object.entries(BET_CAMPAIGN).map(([b, c]) => `${b} to ${c}`).join(", ")}), and the blended figures include that money too. Spend columns and budgets are marketing spend only. Other bets' spend acts on every campaign and stays in the bet tracker.`,
    );
  const orphanSpend = p.daily.filter((d) => d.ms <= s.asOfMs && !p.campaignById.has(d.campaign_id)).length;
  if (orphanSpend) caveats.push(`${orphanSpend} daily marketing row(s) reference a campaign_id that is not in Campaigns; their spend is in totals only.`);
  return {
    value: {
      asOf: s.label,
      phase: s.phase,
      rows,
      totals: {
        spend: totalSpend,
        betSpend: totalBetSpend,
        cost: totalCost,
        registered: totalRegistered,
        attended: s.phase === "pre-event" ? null : attributedAttendees,
        blendedInrPerAttendee: s.phase === "pre-event" || !attributedAttendees ? null : Math.round(totalCost / attributedAttendees),
        blendedInrPerConfirmed: (() => {
          const c = rows.reduce((a, r) => a + r.confirmed, 0);
          return c ? Math.round(totalCost / c) : null;
        })(),
        blendedInrPerRegistration: totalRegistered ? Math.round(totalCost / totalRegistered) : null,
      },
      unattributed: {
        walkIns: s.phase === "pre-event" ? 0 : s.walkIns.size,
        registeredWithoutCampaign: regAttendeesNoCampaign,
      },
    },
    basis: [DEF.asOf, DEF.dedup, DEF.attribution, DEF.spend, DEF.attendee, DEF.showup, "Engaged share = share of registrants who submitted an event question."],
    caveats,
  } satisfies Result<unknown>;
}

export function pace(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const start = p.event.historyStart;
  const endDay = s.day < p.event.startDay ? s.day : p.event.startDay;
  const totalDays = Math.max(1, daysBetween(start, p.event.startDay));
  // registration time per external person (earliest)
  const regMs: number[] = [...s.personReg.values()].map((r) => r.ms).sort((a, b) => a - b);
  const series: { day: string; registered: number; targetLine: number | null; goal: number | null; version: string | null }[] = [];
  let idx = 0;
  for (let d = start, n = 0; d <= endDay && n < 400; d = addDays(d, 1), n++) {
    const eod = endOfIstDay(d);
    while (idx < regMs.length && regMs[idx] <= eod) idx++;
    const t = targetInForce(p, eod);
    const elapsed = Math.min(totalDays, daysBetween(start, d));
    series.push({
      day: d,
      registered: idx,
      targetLine: t ? Math.round((t.registration_goal * elapsed) / totalDays) : null,
      goal: t?.registration_goal ?? null,
      version: t?.target_version ?? null,
    });
  }
  const last = series[series.length - 1];
  const daysLeft = Math.max(0, daysBetween(s.day, p.event.startDay));
  const weekAgo = series[Math.max(0, series.length - 8)];
  const last7 = last && weekAgo ? (last.registered - weekAgo.registered) / Math.max(1, series.length - 1 - Math.max(0, series.length - 8)) : 0;
  const needed = last?.goal != null && daysLeft > 0 ? Math.max(0, (last.goal - last.registered) / daysLeft) : null;
  return {
    value: {
      asOf: s.label,
      series,
      latest: last ?? null,
      gapToLine: last?.targetLine != null ? last.registered - last.targetLine : null,
      daysToEvent: daysLeft,
      avgDailyLast7: r1(last7),
      requiredDailyToGoal: needed != null ? r1(needed) : null,
    },
    basis: [DEF.asOf, DEF.registered, "Each day uses the registration goal of the target version in force that day."],
    caveats: [...baseCaveats(s), "ASSUMPTION: the target line is linear from history start to event start; real registrations are back-loaded, so falling below the line early is not by itself a failure."],
  } satisfies Result<unknown>;
}

export interface ProjectionValue {
  mode: "projection" | "actual";
  asOf: string;
  confirmedNow: number;
  assumptions: { showupLow: number; showupMid: number; showupHigh: number; walkIns: number };
  low: number;
  mid: number;
  high: number;
  goal: number | null;
  actual: number | null;
  projectionError: null | { projectedMid: number; actual: number; errorPct: number; madeAsOf: string };
}

export function projection(data: Dataset, asOf: string): Result<ProjectionValue> {
  const s = snapshot(data, asOf);
  const st = s.p.settings;
  const t = targetInForce(s.p, s.asOfMs);
  const { counts } = externalStatusCounts(s, s.asOfMs);
  const confirmedNow = counts.confirmed;
  const w = st.walkin_assumption;
  const mk = (rate: number) => Math.round(confirmedNow * rate + w);
  if (s.phase === "pre-event") {
    return {
      value: {
        mode: "projection",
        asOf: s.label,
        confirmedNow,
        assumptions: { showupLow: st.showup_low, showupMid: st.showup_mid, showupHigh: st.showup_high, walkIns: w },
        low: mk(st.showup_low),
        mid: mk(st.showup_mid),
        high: mk(st.showup_high),
        goal: t?.unique_external_visitors_goal ?? null,
        actual: null,
        projectionError: null,
      },
      basis: [DEF.asOf, DEF.status, "Projected visitors = confirmed external registrants now x show-up assumption + walk-in assumption."],
      caveats: [...baseCaveats(s), "ASSUMPTION: show-up rates and walk-ins come from Settings, not observed data. Registrations still to come before the event are not included, so this is a floor if acquisition continues."],
    };
  }
  // after the event starts: actual, plus how the day-before projection performed
  const dayBefore = addDays(s.p.event.startDay, -1);
  const before = projection(data, dayBefore).value;
  const actual = s.attendees.size;
  return {
    value: {
      mode: "actual",
      asOf: s.label,
      confirmedNow: externalStatusCounts(s).counts.confirmed,
      assumptions: { showupLow: st.showup_low, showupMid: st.showup_mid, showupHigh: st.showup_high, walkIns: w },
      low: before.low,
      mid: before.mid,
      high: before.high,
      goal: t?.unique_external_visitors_goal ?? null,
      actual,
      projectionError: { projectedMid: before.mid, actual, errorPct: r1(((actual - before.mid) / Math.max(1, before.mid)) * 100), madeAsOf: dayBefore },
    },
    basis: [DEF.asOf, DEF.attendee, `Projection error compares the actual with the mid-case projection made as of ${dayBefore}.`],
    caveats: baseCaveats(s),
  };
}

export type FlagLevel = "scale" | "watch" | "stop";

export function flags(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const st = s.p.settings;
  const table = campaignTable(data, asOf).value;
  const post = s.phase === "post-event";
  const blended = post ? table.totals.blendedInrPerAttendee : table.totals.blendedInrPerConfirmed;
  const totalReg = table.totals.registered;
  const askers = [...s.personReg.keys()].filter((pid) => s.questionAskers.has(pid)).length;
  const overallEngaged = totalReg ? (askers / totalReg) * 100 : 0;
  const out = table.rows.map((c) => {
    const unit = post ? c.inrPerAttendee : c.inrPerConfirmed;
    const sample = post ? c.registered : c.confirmed;
    const costRatio = unit != null && blended ? unit / blended : null;
    let level: FlagLevel = "watch";
    let reason: string;
    const inr = (x: number | null) => (x == null ? "n/a" : `INR ${x.toLocaleString("en-IN")}`);
    if (c.app_status === "stopped") {
      reason = "Campaign is marked stopped in the plan; shown for reference.";
    } else if (sample < st.min_sample) {
      reason = `Only ${sample} ${post ? "registrations" : "confirmed"}; below the minimum sample of ${st.min_sample}, too little data to judge.`;
    } else if (costRatio == null) {
      reason = post ? "No attributed attendees, so cost per attendee is undefined." : "No confirmed registrants yet.";
      level = post && c.cost > 0 ? "stop" : "watch";
    } else if (post) {
      const su = (c.showUpPct ?? 0) / 100;
      if (costRatio >= st.stop_cost_ratio || su < st.stop_max_showup) {
        level = "stop";
        reason = `${inr(unit)} per actual attendee is ${costRatio.toFixed(2)}x the blended ${inr(blended)}, show-up ${c.showUpPct}%. Stop rule: ratio >= ${st.stop_cost_ratio} or show-up < ${Math.round(st.stop_max_showup * 100)}%.`;
      } else if (costRatio <= st.scale_cost_ratio && su >= st.scale_min_showup) {
        level = "scale";
        reason = `${inr(unit)} per actual attendee is ${costRatio.toFixed(2)}x the blended ${inr(blended)}, with ${c.showUpPct}% show-up. Scale rule: ratio <= ${st.scale_cost_ratio} and show-up >= ${Math.round(st.scale_min_showup * 100)}%.`;
      } else {
        reason = `${inr(unit)} per actual attendee (${costRatio.toFixed(2)}x blended ${inr(blended)}), show-up ${c.showUpPct}%. Between the scale and stop thresholds.`;
      }
    } else {
      const eng = c.engagedSharePct ?? 0;
      if (costRatio >= st.stop_cost_ratio) {
        level = "stop";
        reason = `${inr(unit)} per confirmed registrant is ${costRatio.toFixed(2)}x the blended ${inr(blended)} (stop at ${st.stop_cost_ratio}x). Engaged share ${eng}% vs ${r1(overallEngaged)}% overall.`;
      } else if (costRatio <= st.scale_cost_ratio) {
        level = "scale";
        reason = `${inr(unit)} per confirmed registrant is ${costRatio.toFixed(2)}x the blended ${inr(blended)} (scale at <= ${st.scale_cost_ratio}x); engaged share ${eng}% vs ${r1(overallEngaged)}% overall (context only).`;
      } else {
        reason = `${inr(unit)} per confirmed (${costRatio.toFixed(2)}x blended ${inr(blended)}); engaged share ${eng}%. Between thresholds.`;
      }
    }
    if (c.betSpend && costRatio != null) reason += ` Cost = ${inr(c.spend)} marketing + ${inr(c.betSpend)} bet operating spend.`;
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      level,
      reason,
      rule: post ? "post-event: INR per actual attendee vs blended + show-up" : "pre-event proxy: INR per confirmed vs blended",
      metrics: {
        spend: c.spend,
        betSpend: c.betSpend,
        registered: c.registered,
        confirmed: c.confirmed,
        attended: c.attended,
        showUpPct: c.showUpPct,
        unitCost: unit,
        blendedUnitCost: blended,
        costRatio: costRatio != null ? Math.round(costRatio * 100) / 100 : null,
        engagedSharePct: c.engagedSharePct,
      },
    };
  });
  const order: Record<FlagLevel, number> = { stop: 0, scale: 1, watch: 2 };
  out.sort((a, b) => order[a.level] - order[b.level] || (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0));
  const caveats = baseCaveats(s);
  caveats.push("Flags use straight thresholds from Settings and do not model channel saturation: a SCALE flag means 'test more budget', not 'move all budget'.");
  if (!post)
    caveats.push(
      "Before the event, cost per confirmed registrant is a PROXY for cost per actual attendee: it ignores channel differences in show-up. Engaged share is context only.",
    );
  if (s.phase === "live") caveats.push("Event in progress: pre-event proxy rules are used until the event ends.");
  return {
    value: { asOf: s.label, phase: s.phase, flags: out, thresholds: st },
    basis: [DEF.asOf, DEF.attribution, DEF.spend, post ? DEF.showup : "Engaged = submitted an event question. Context only: it does not change the pre-event flag."],
    caveats,
  } satisfies Result<unknown>;
}

export function dataHealth(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const cks = p.checkins.filter((c) => c.ms <= s.asOfMs);
  const nonExternalAdmits = cks.filter((c) => countsAsAdmission(c) && !s.isExternal(c.person_id));
  const negative = p.daily.filter((d) => d.ms <= s.asOfMs && Number(d.marketing_spend_inr ?? 0) < 0);
  const orphanCheckins = cks.filter((c) => !p.personById.has(c.person_id)).length;
  const regsWithoutHistory = s.regsAsOf.filter((r) => !p.historyByReg.has(r.registration_id)).length;
  const admittedExternal = cks.filter((c) => countsAsAdmission(c) && s.isExternal(c.person_id)).length;
  return {
    value: {
      asOf: s.label,
      duplicates: p.dedup.map((d) => ({ table: d.table, idField: d.idField, raw: d.raw, unique: d.unique, identicalCopies: d.identicalCopies, conflicting: d.conflictingIds.length, conflictingIds: d.conflictingIds.slice(0, 20) })),
      checkins: {
        total: cks.length,
        deniedScans: cks.filter((c) => c.result === "denied").length,
        pendingScans: cks.filter((c) => c.result === "pending").length,
        unverified: cks.filter((c) => c.verification !== "verified").length,
        nonExternalAdmissions: nonExternalAdmits.length,
        nonExternalPeople: new Set(nonExternalAdmits.map((c) => c.person_id)).size,
        verifiedExternalAdmissions: admittedExternal,
        distinctVerifiedExternalPeople: s.attendees.size,
        repeatAdmissions: admittedExternal - s.attendees.size,
        orphanCheckins,
      },
      spend: { negativeRows: negative.length, negativeTotal: negative.reduce((a, d) => a + Number(d.marketing_spend_inr ?? 0), 0) },
      unattributedVisitors: s.walkIns.size,
      registrationsWithoutHistory: regsWithoutHistory,
      warnings: p.warnings,
      // problem records by kind; the Data quality screen lists every one
      problems: qualitySummary(dataQuality(data)),
    },
    basis: [DEF.asOf, DEF.dedup, DEF.attendee, "Duplicate counts cover the whole loaded dataset, not just rows up to as-of."],
    caveats: [] as string[],
  } satisfies Result<unknown>;
}

export interface TimelineItem {
  at: string;
  ms: number;
  kind: "first_seen" | "interaction" | "registration" | "status" | "checkin";
  title: string;
  detail: string | null;
  campaign_id: string | null;
  counts: boolean | null; // for check-ins: does this record count toward attendance?
}

export function person(data: Dataset, personId: string, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const x = p.personById.get(personId);
  if (!x || x.ms > s.asOfMs)
    return {
      value: null,
      basis: [DEF.asOf],
      caveats: [x ? `Person ${personId} is first seen after this as-of date.` : `No person with id ${personId} exists in the data.`],
    } satisfies Result<null>;
  const items: TimelineItem[] = [
    { at: x.first_seen_at, ms: x.ms, kind: "first_seen", title: `First seen (${x.first_touch_source ?? "unknown source"})`, detail: x.first_campaign_name, campaign_id: x.first_campaign_id, counts: null },
  ];
  for (const i of p.interactionsByPerson.get(personId) ?? [])
    if (i.ms <= s.asOfMs) items.push({ at: i.occurred_at, ms: i.ms, kind: "interaction", title: i.event_type.replace(/_/g, " "), detail: i.detail, campaign_id: i.campaign_id, counts: null });
  const regs = (p.regsByPerson.get(personId) ?? []).filter((r) => r.ms <= s.asOfMs);
  for (const r of regs) {
    items.push({ at: r.registered_at, ms: r.ms, kind: "registration", title: `Registered (${r.registration_id})`, detail: r.campaign_name, campaign_id: r.campaign_id, counts: null });
    for (const h of p.historyByReg.get(r.registration_id) ?? [])
      if (h.ms <= s.asOfMs) items.push({ at: h.effective_at, ms: h.ms, kind: "status", title: `Status: ${h.status}`, detail: `${h.history_id} on ${h.registration_id}`, campaign_id: h.campaign_id, counts: null });
  }
  for (const c of p.checkins)
    if (c.person_id === personId && c.ms <= s.asOfMs) {
      const ok = countsAsAdmission(c) && x.person_type === "external";
      items.push({ at: c.occurred_at, ms: c.ms, kind: "checkin", title: `Check-in: ${c.result}, ${c.verification} (${c.source})`, detail: c.event_id, campaign_id: c.campaign_id, counts: ok });
    }
  items.sort((a, b) => a.ms - b.ms);
  const currentStatus = regs.map((r) => ({ registration_id: r.registration_id, campaign_id: r.campaign_id, status: s.statusOf(r.registration_id, s.asOfMs)?.status ?? null }));
  return {
    value: {
      profile: { ...x, ms: undefined },
      registrations: currentStatus,
      attended: s.attendees.has(personId),
      walkIn: s.walkIns.has(personId),
      engaged: s.questionAskers.has(personId),
      timeline: items,
    },
    basis: [DEF.asOf, DEF.dedup, DEF.status, DEF.attendee, "Names can repeat; person_id is the identity key."],
    caveats: x.person_type !== "external" ? [`This person is '${x.person_type}', so their check-ins never count as attendance.`] : [],
  } satisfies Result<unknown>;
}

export function peopleDirectory(
  data: Dataset,
  asOf: string,
  opts: {
    q?: string;
    page?: number;
    pageSize?: number;
    personType?: string;
    /** registration campaign (the app's attribution rule); "none" = not registered */
    campaignId?: string;
    /** latest registration status; "none" = not registered */
    status?: string;
    attended?: "yes" | "no";
    engaged?: "yes" | "no";
  } = {},
) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const q = (opts.q ?? "").trim().toLowerCase();
  const pageSize = Math.min(200, opts.pageSize ?? 50);
  const page = Math.max(1, opts.page ?? 1);
  // fields are computed for every match first, so the filters see all people and not just one page
  const all = p.people
    .filter((x) => x.ms <= s.asOfMs && (!q || x.person_id.toLowerCase().includes(q) || x.person_name.toLowerCase().includes(q)) && (!opts.personType || x.person_type === opts.personType))
    .map((x) => {
      const reg = (p.regsByPerson.get(x.person_id) ?? []).filter((r) => r.ms <= s.asOfMs).sort((a, b) => a.ms - b.ms)[0];
      return {
        person_id: x.person_id,
        person_name: x.person_name,
        person_type: x.person_type,
        first_campaign_id: x.first_campaign_id,
        registration_campaign_id: reg?.campaign_id ?? null,
        latest_status: reg ? (s.statusOf(reg.registration_id, s.asOfMs)?.status ?? null) : null,
        attended: s.attendees.has(x.person_id),
        engaged: s.questionAskers.has(x.person_id),
      };
    })
    .filter(
      (r) =>
        (!opts.campaignId || (opts.campaignId === "none" ? r.registration_campaign_id === null : r.registration_campaign_id === opts.campaignId)) &&
        (!opts.status || (opts.status === "none" ? r.latest_status === null : r.latest_status === opts.status)) &&
        (!opts.attended || r.attended === (opts.attended === "yes")) &&
        (!opts.engaged || r.engaged === (opts.engaged === "yes")),
    );
  const rows = all.slice((page - 1) * pageSize, page * pageSize);
  const basis = [DEF.asOf, DEF.status, DEF.attendee];
  if (opts.campaignId) basis.push(DEF.attribution);
  return {
    value: { total: all.length, page, pageSize, rows },
    basis,
    caveats: [] as string[],
  } satisfies Result<unknown>;
}

export function dailyCampaign(data: Dataset, campaignId: string, asOf: string) {
  const s = snapshot(data, asOf);
  const c = s.p.campaignById.get(campaignId);
  if (!c) return { value: null, basis: [DEF.asOf], caveats: [`No campaign with id ${campaignId}.`] } satisfies Result<null>;
  const rows = s.p.daily
    .filter((d) => d.campaign_id === campaignId && d.ms <= s.asOfMs)
    .sort((a, b) => a.activity_date.localeCompare(b.activity_date))
    .map((d) => ({
      day: d.activity_date,
      spend: Number(d.marketing_spend_inr ?? 0),
      impressions: Number(d.impressions ?? 0),
      clicks: Number(d.clicks ?? 0),
      reach: Number(d.reported_reach ?? 0),
      sessions: Number(d.landing_page_sessions ?? 0),
      registrationStarts: Number(d.registration_starts ?? 0),
    }));
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + Number(r[k]), 0);
  return {
    value: {
      campaign_id: campaignId,
      campaign_name: c.campaign_name,
      rows,
      totals: { spend: sum("spend"), impressions: sum("impressions"), clicks: sum("clicks"), sessions: sum("sessions"), registrationStarts: sum("registrationStarts") },
    },
    basis: [DEF.asOf, DEF.dedup, DEF.spend, DEF.anonymous],
    caveats: ["Reach is platform-reported per day; summing it does NOT give unique people, so no total reach is shown."],
  } satisfies Result<unknown>;
}

/** What is driving change: registrations and spend per campaign, last N days vs the N days before. */
export function momentum(data: Dataset, asOf: string, opts: { windowDays?: number } = {}) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const n = Math.max(1, Math.min(60, opts.windowDays ?? 7));
  const curStart = endOfIstDay(addDays(s.day, -n));
  const prevStart = endOfIstDay(addDays(s.day, -2 * n));
  const rows = p.campaigns
    .filter((c) => !Number.isFinite(c.ms) || c.ms <= s.asOfMs)
    .map((c) => {
      let cur = 0,
        prev = 0;
      for (const r of s.personReg.values()) {
        if (r.campaign_id !== c.campaign_id) continue;
        if (r.ms > curStart && r.ms <= s.asOfMs) cur++;
        else if (r.ms > prevStart && r.ms <= curStart) prev++;
      }
      let spendCur = 0,
        spendPrev = 0;
      for (const d of p.daily) {
        if (d.campaign_id !== c.campaign_id) continue;
        if (d.ms > curStart && d.ms <= s.asOfMs) spendCur += Number(d.marketing_spend_inr ?? 0);
        else if (d.ms > prevStart && d.ms <= curStart) spendPrev += Number(d.marketing_spend_inr ?? 0);
      }
      return { campaign_id: c.campaign_id, campaign_name: c.campaign_name, registrations: cur, registrationsPrev: prev, delta: cur - prev, spend: spendCur, spendPrev };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const recentEdits = (data.change_log ?? []).slice(-10);
  return {
    value: { asOf: s.label, windowDays: n, rows, total: rows.reduce((a, r) => a + r.registrations, 0), totalPrev: rows.reduce((a, r) => a + r.registrationsPrev, 0), recentEdits },
    basis: [DEF.asOf, DEF.registered, DEF.attribution, `Window = the ${n} days ending at as-of vs the ${n} days before.`],
    caveats: ["Movement shows correlation in time, not cause. Recent data edits (change log) are listed because they can move numbers too."],
  } satisfies Result<unknown>;
}

/** Post-event evidence on what predicts show-up: engagement type and registration lead time. */
export function showupDrivers(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  if (s.phase === "pre-event")
    return { value: null, basis: [DEF.asOf], caveats: ["Show-up drivers need attendance data; this as-of date is before the event, so the data cannot answer yet."] } satisfies Result<null>;
  const types = new Map<string, Set<string>>();
  for (const i of p.interactions) {
    if (i.ms > s.asOfMs) continue;
    if (!types.has(i.event_type)) types.set(i.event_type, new Set());
    types.get(i.event_type)!.add(i.person_id);
  }
  const regs = [...s.personReg.keys()];
  const byEngagement = [...types.entries()].map(([type, set]) => {
    const group = regs.filter((pid) => set.has(pid));
    const att = group.filter((pid) => s.attendees.has(pid)).length;
    return { segment: type, registrants: group.length, attended: att, showUpPct: group.length ? r1((att / group.length) * 100) : null };
  });
  const noEng = regs.filter((pid) => !["event_question_submitted", "nurture_email_opened", "nurture_email_clicked", "brochure_download"].some((t) => types.get(t)?.has(pid)));
  byEngagement.push({ segment: "none of: question, email open or click, brochure download", registrants: noEng.length, attended: noEng.filter((pid) => s.attendees.has(pid)).length, showUpPct: noEng.length ? r1((noEng.filter((pid) => s.attendees.has(pid)).length / noEng.length) * 100) : null });
  const buckets = new Map<string, { n: number; a: number }>();
  for (const [pid, r] of s.personReg) {
    const weeks = Math.floor((p.event.startMs - r.ms) / (7 * 86400000));
    const key = weeks < 0 ? "after start" : weeks >= 10 ? "10+ weeks out" : `${weeks}-${weeks + 1} weeks out`;
    const b = buckets.get(key) ?? { n: 0, a: 0 };
    b.n++;
    if (s.attendees.has(pid)) b.a++;
    buckets.set(key, b);
  }
  const byLeadTime = [...buckets.entries()].map(([bucket, b]) => ({ bucket, registrants: b.n, attended: b.a, showUpPct: r1((b.a / b.n) * 100) }));
  return {
    value: { asOf: s.label, byEngagement, byLeadTime },
    basis: [DEF.asOf, DEF.attendee, "Segments are registrants (external, registered at or before as-of) grouped by identified interactions; a person can be in several engagement segments."],
    caveats: ["These are associations: engaged people may have been more likely to attend anyway."],
  } satisfies Result<unknown>;
}

export function tasksView(
  data: Dataset,
  asOf: string,
  opts: { status?: string; campaign_id?: string; owner_id?: string; team?: string; overdueOnly?: boolean } = {},
) {
  const { ms } = resolveAsOf(asOf);
  const team = new Map((data.team ?? []).map((t) => [t.owner_id, t]));
  const isOverdue = (t: TaskRow) => t.status !== "done" && !!t.due_at && toMs(t.due_at) < ms;
  const rows = (data.tasks ?? [])
    .filter(
      (t) =>
        (!opts.status || t.status === opts.status) &&
        (!opts.campaign_id || t.campaign_id === opts.campaign_id) &&
        (!opts.owner_id || t.owner_id === opts.owner_id) &&
        (!opts.team || (t.owner_id ? team.get(t.owner_id)?.team : null) === opts.team) &&
        (!opts.overdueOnly || isOverdue(t)),
    )
    .map((t) => ({ ...t, overdue: isOverdue(t), owner_name: t.owner_id ? (team.get(t.owner_id)?.owner_name ?? t.owner_id) : null, team: t.owner_id ? (team.get(t.owner_id)?.team ?? null) : null }));
  const byStatus: Record<string, number> = { todo: 0, doing: 0, blocked: 0, done: 0 };
  for (const t of data.tasks ?? []) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  return {
    value: { asOf: istDay(ms), rows, byStatus, overdue: (data.tasks ?? []).filter(isOverdue).length },
    basis: ["Tasks are app data (not historical). Overdue = not done and due before the as-of time, which the app treats as 'now'."],
    caveats: (data.tasks ?? []).length ? [] : ["There are no tasks yet."],
  } satisfies Result<unknown>;
}

export function eventInfo(data: Dataset) {
  const p = prepare(data);
  return {
    value: { ...p.event, targets: p.targets.map((t) => ({ ...t, ms: undefined })) },
    basis: ["Event and target rows as loaded."],
    caveats: p.warnings,
  } satisfies Result<unknown>;
}
