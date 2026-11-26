// Budget and show-up scenarios. Every figure that comes out of here rests on labelled assumptions.
// After the event it replays the campaign with a different allocation. Before the event, money already
// spent cannot move: only the unspent budget can change, and the result is a CHANGE, not a new total.
import { baseCaveats, campaignTable, DEF, externalStatusCounts, projection, snapshot, targetsVsActuals } from "./metrics";
import type { Dataset, Result } from "./types";

export interface Move {
  from?: string;
  to?: string;
  inr: number;
}
export interface WhatIfSpec {
  asOf: string;
  moves?: Move[];
  /** change to the whole marketing budget: negative = cut */
  budgetChangePct?: number;
  budgetChangeInr?: number;
  cutStrategy?: "proportional" | "costliest_first";
  /** share of confirmed registrants who attend, in percent */
  confirmedShowUpPct?: number;
  capacityAttendees?: number;
}

const r0 = Math.round;
const inrText = (x: number) => `INR ${r0(x).toLocaleString("en-IN")}`;

export function whatIf(data: Dataset, spec: WhatIfSpec) {
  const s = snapshot(data, spec.asOf);
  const st = s.p.settings;
  const post = s.phase === "post-event";
  const table = campaignTable(data, spec.asOf).value;
  const rows = new Map(table.rows.map((r) => [r.campaign_id, r]));
  const caveats = baseCaveats(s);
  const assumptions: string[] = [];
  const cannot = (why: string): Result<null> => ({ value: null, basis: [DEF.asOf], caveats: [why, ...caveats] });

  const moves: Move[] = [...(spec.moves ?? [])];
  for (const m of moves) {
    if (!(m.inr > 0)) return cannot("Each move needs a positive amount in INR.");
    if (!m.from && !m.to) return cannot("Each move needs a 'from' campaign, a 'to' campaign, or both.");
    const unknown = [m.from, m.to].find((id) => id && !rows.has(id));
    if (unknown) return cannot(`No campaign '${unknown}' exists at this date. Campaigns: ${[...rows.keys()].join(", ")}.`);
  }

  const tva = targetsVsActuals(data, spec.asOf).value;
  const budget = tva.rows.find((r) => r.key === "spend")?.goal ?? null;
  const unspent = budget != null ? Math.max(0, budget - table.totals.spend) : null;

  // A whole-budget change is turned into per-campaign moves so one set of rules applies.
  // Percentages are of total spend after the event, and of the budget in force before it.
  const pctBase = post ? table.totals.spend : budget;
  if (spec.budgetChangePct != null && spec.budgetChangeInr == null && pctBase == null) return cannot("No budget is in force at this date, so a percentage cannot be applied. Give the amount in INR.");
  const change = spec.budgetChangeInr ?? (spec.budgetChangePct != null ? (pctBase! * spec.budgetChangePct) / 100 : 0);
  if (change > 0) return cannot("An increase needs a destination: add moves with only 'to' campaigns. The data cannot say where extra money would work best.");
  if (change < 0) {
    let cut = Math.min(-change, table.totals.spend);
    if (!post && unspent != null) {
      if (-change > unspent) caveats.push(`Only ${inrText(unspent)} of the ${inrText(budget!)} budget is unspent. Money already spent cannot be taken back, so the cut is limited to that.`);
      cut = Math.min(-change, unspent);
      if (cut <= 0) return cannot("The whole budget is already spent at this date, so there is nothing left to cut.");
    }
    const strategy = spec.cutStrategy ?? "proportional";
    const unitOf = (id: string) => (post ? rows.get(id)!.inrPerAttendee : rows.get(id)!.inrPerConfirmed) ?? Number.POSITIVE_INFINITY;
    if (strategy === "proportional") {
      const positive = [...rows.values()].filter((r) => r.spend > 0);
      const total = positive.reduce((a, r) => a + r.spend, 0);
      for (const r of positive) moves.push({ from: r.campaign_id, inr: (cut * r.spend) / total });
    } else {
      let left = cut;
      for (const r of [...rows.values()].filter((x) => x.spend > 0).sort((a, b) => unitOf(b.campaign_id) - unitOf(a.campaign_id))) {
        if (left <= 0) break;
        const take = post ? Math.min(left, r.spend) : left;
        moves.push({ from: r.campaign_id, inr: take });
        left -= take;
      }
    }
    assumptions.push(`The ${inrText(cut)} cut is applied ${strategy === "proportional" ? "in proportion to each campaign's spend so far" : "to the costliest campaigns first"}${post ? "" : ", and comes out of future spend"}.`);
  }
  if (!moves.length && spec.confirmedShowUpPct == null) return cannot("Nothing to simulate: give budget moves, a budget cut, or a show-up rate.");

  const out = new Map<string, number>();
  const into = new Map<string, number>();
  for (const m of moves) {
    if (m.from) out.set(m.from, (out.get(m.from) ?? 0) + m.inr);
    if (m.to) into.set(m.to, (into.get(m.to) ?? 0) + m.inr);
  }
  if (post) {
    for (const [id, amount] of out)
      if (amount > rows.get(id)!.spend + 0.5) return cannot(`${id} has only ${inrText(rows.get(id)!.spend)} of spend at this date, so ${inrText(amount)} cannot be taken out.`);
  } else if (unspent != null) {
    const moved = [...out.values()].reduce((a, b) => a + b, 0);
    const newMoney = Math.max(0, [...into.values()].reduce((a, b) => a + b, 0) - moved);
    if (moved > unspent + 0.5) return cannot(`Only ${inrText(unspent)} of the budget is unspent at this date. Money already spent cannot be moved or cut.`);
    if (moved + newMoney > unspent + 0.5) caveats.push(`This needs more than the ${inrText(unspent)} still unspent, so it goes over the ${inrText(budget!)} budget.`);
  }
  if (!post && moves.length) assumptions.push(`ASSUMPTION: this changes how the unspent budget (${unspent != null ? inrText(unspent) : "unknown amount"}) will be spent. The data holds no per-campaign plan for it.`);

  const unitLabel = post ? "actual attendee" : "confirmed registrant";
  const lines: { campaign_id: string; campaign_name: string; direction: "cut" | "add"; inr: number; averageUnitCost: number; effectCautious: number; effectOptimistic: number }[] = [];
  const apply = (id: string, amount: number, direction: "cut" | "add") => {
    const r = rows.get(id)!;
    const base = post ? r.attended : r.confirmed;
    if (!base || r.spend <= 0) {
      caveats.push(`${id} has no ${unitLabel}s or no spend at this date, so the effect of changing its budget is unknown and counted as zero.`);
      return;
    }
    const unit = r.spend / base;
    const effect = (penalty: number) => (direction === "cut" ? -(post ? Math.min(base, amount / unit) : amount / unit) : amount / (unit * penalty));
    if (direction === "add" && amount > r.spend) caveats.push(`${id}: adding ${inrText(amount)} more than doubles its spend, far outside anything observed.`);
    lines.push({ campaign_id: id, campaign_name: r.campaign_name, direction, inr: r0(amount), averageUnitCost: r0(unit), effectCautious: effect(st.whatif_penalty_base), effectOptimistic: effect(st.whatif_penalty_stretch) });
  };
  for (const [id, amount] of out) apply(id, amount, "cut");
  for (const [id, amount] of into) apply(id, amount, "add");
  if (lines.some((l) => l.direction === "cut")) assumptions.push(`ASSUMPTION: money removed from a campaign loses ${unitLabel}s at its average cost.`);
  if (lines.some((l) => l.direction === "add"))
    assumptions.push(`ASSUMPTION: money added buys ${unitLabel}s at ${st.whatif_penalty_base}x (cautious) to ${st.whatif_penalty_stretch}x (optimistic) the channel's average cost, because channels saturate. Both multiples are editable in Settings.`);

  let cautious = lines.reduce((a, l) => a + l.effectCautious, 0);
  let optimistic = lines.reduce((a, l) => a + l.effectOptimistic, 0);
  let baseline: number;
  const { counts } = externalStatusCounts(s);
  if (post) {
    baseline = s.attendees.size;
  } else {
    // before the event the budget effect is in confirmed registrants; convert with the Settings show-up rate
    cautious *= st.showup_mid;
    optimistic *= st.showup_mid;
    baseline = projection(data, spec.asOf).value.mid;
    if (lines.length) {
      assumptions.push(`ASSUMPTION: extra or lost confirmed registrants attend at the Settings mid rate of ${r0(st.showup_mid * 100)}%.`);
      caveats.push("Actual attendance by channel is not known at this date. This compares cost per confirmed registrant only, so it cannot show that one channel's people are more likely to attend.");
    }
  }

  let showUp: null | { fromPct: number; toPct: number; confirmed: number; effect: number } = null;
  if (spec.confirmedShowUpPct != null) {
    if (spec.confirmedShowUpPct < 0 || spec.confirmedShowUpPct > 100) return cannot("A show-up rate must be between 0 and 100 percent.");
    const confirmed = counts.confirmed;
    if (!confirmed) return cannot("There are no confirmed registrants at this date.");
    const fromRate = post ? s.registeredAttendees.size / confirmed : st.showup_mid;
    const effect = confirmed * (spec.confirmedShowUpPct / 100 - fromRate);
    showUp = { fromPct: r0(fromRate * 1000) / 10, toPct: spec.confirmedShowUpPct, confirmed, effect: r0(effect) };
    cautious += effect;
    optimistic += effect;
    assumptions.push(`ASSUMPTION: ${spec.confirmedShowUpPct}% of ${confirmed} confirmed registrants attend instead of ${showUp.fromPct}%. Nothing in the data shows which action would achieve this.`);
    if (lines.length) caveats.push("The show-up change and the budget change are simply added; any interaction between them is ignored.");
  }

  // Before the event the projection counts only today's confirmed people, so a change to future
  // spend cannot be added to it. A show-up change alone does apply to today's confirmed people.
  const totalIsMeaningful = post || !lines.length;
  const result = (delta: number) => ({ attendeeChange: r0(delta), attendees: totalIsMeaningful ? r0(baseline + delta) : null });
  const lo = result(Math.min(cautious, optimistic));
  const hi = result(Math.max(cautious, optimistic));
  if (spec.capacityAttendees != null) {
    assumptions.push(`ASSUMPTION: capacity of ${spec.capacityAttendees} distinct attendees, as given in the question.`);
    if (hi.attendees != null && hi.attendees > spec.capacityAttendees) caveats.push(`The upper result (${hi.attendees}) is above the stated capacity of ${spec.capacityAttendees}.`);
  } else caveats.push("Venue capacity is not in the data, so these results are not capacity-checked.");
  if (!totalIsMeaningful) caveats.push("The result is a change compared with spending the unspent budget the way it has been spent so far. No new total is given: today's projection leaves out registrations that future spend would bring.");
  if (lo.attendeeChange < 0 && hi.attendeeChange > 0) caveats.push("The range spans both a loss and a gain: the data cannot say whether this change helps.");
  caveats.push("This is arithmetic on observed averages, not evidence that the change would cause these results.");

  const netBudget = [...into.values()].reduce((a, b) => a + b, 0) - [...out.values()].reduce((a, b) => a + b, 0);
  return {
    value: {
      asOf: s.label,
      phase: s.phase,
      baseline: { attendees: baseline, kind: post ? "actual" : "projected (mid case)", spend: table.totals.spend },
      budget: { inForce: budget, spentSoFar: table.totals.spend, unspent },
      netBudgetChangeInr: r0(netBudget),
      lines: lines.map((l) => ({ ...l, effectCautious: r0(l.effectCautious), effectOptimistic: r0(l.effectOptimistic), effectUnit: unitLabel })),
      showUp,
      low: lo,
      high: hi,
      assumptions,
    },
    basis: [DEF.asOf, DEF.attribution, DEF.spend, post ? DEF.attendee : "Before the event, budget effects use cost per confirmed registrant."],
    caveats,
  } satisfies Result<unknown>;
}
