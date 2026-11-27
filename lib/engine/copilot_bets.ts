// Copilot views of the bet records: compact wrappers around the P5 engine (bet tracker, program,
// Championship) plus money (payments, passes, claims). Each returns { value, basis, caveats } and stays
// small, because a tool result going to the model is cut at about 14,000 characters.
// On the original dataset the records do not exist; every tool says so and returns no figure for them.
import { betTracker, kpi, VERDICT_LABEL, type KpiResult } from "./bets";
import { betsAsOf, numberOf, text, word } from "./betview";
import { championship } from "./championship";
import { programView } from "./program";
import { resolveAsOf } from "./time";
import type { Dataset, Result } from "./types";

export const NO_BET_RECORDS =
  "This dataset (the original one, from before the bets) has no bet, contingent, squad, pass, payment, seat booking, waitlist, exchange offer, claim, hackathon or Championship records. These figures do not exist here. Do not use figures from the simulated run or from the plan as results.";

const SIM_NOTE = "SIMULATED: a made-up run of the plan, not real results and not evidence for the target.";

const BREAKDOWN_ROWS = 15;

function kpiLine(k: KpiResult, detail: boolean) {
  const base = {
    id: k.id,
    name: k.name,
    verdict: VERDICT_LABEL[k.verdict],
    value: k.display,
    judgedOn: k.judgedOn,
    latestAtSelectedDate: k.latest,
    sample: k.sample == null ? null : `${k.sample} ${k.sampleLabel}`.trim(),
    action: k.action,
    note: k.note,
    proxy: k.proxy || undefined,
  };
  if (!detail) return base;
  return {
    ...base,
    timing: k.timing,
    formula: k.formula,
    threshold: k.threshold
      ? { checkOn: k.threshold.checkOn, direction: k.threshold.direction, scaleAt: k.threshold.scaleAt, stopAt: k.threshold.stopAt, minSample: k.threshold.minSample, actions: k.threshold.actions }
      : null,
    numbers: k.numbers,
    warnings: k.warnings,
    breakdown: k.breakdown
      ? {
          title: k.breakdown.title,
          columns: k.breakdown.columns,
          rows: k.breakdown.rows.slice(0, BREAKDOWN_ROWS).map((r) => [r.id, ...r.cells, ...(r.verdict ? [VERDICT_LABEL[r.verdict]] : [])]),
          rowsTotal: k.breakdown.rows.length,
          verdictCounts: k.breakdown.rows.some((r) => r.verdict)
            ? Object.fromEntries(Object.entries(k.breakdown.rows.reduce<Record<string, number>>((a, r) => (r.verdict ? ((a[VERDICT_LABEL[r.verdict]] = (a[VERDICT_LABEL[r.verdict]] ?? 0) + 1), a) : a), {})))
            : undefined,
        }
      : null,
  };
}

/** bet cards with their KPI verdicts; one bet or one KPI in detail */
export function betStatus(data: Dataset, asOf: string, opts: { betId?: string; kpiId?: string } = {}): Result<unknown> {
  const t = betTracker(data, asOf);
  const v = t.value;
  const caveats = [...t.caveats, ...(data.bets ? [SIM_NOTE] : [NO_BET_RECORDS])];
  if (opts.kpiId) {
    const id = opts.kpiId.trim().toUpperCase();
    const all = [...v.bets, v.plan];
    const owner = all.find((b) => b.kpis.some((k) => k.id === id));
    if (!owner) return { value: { error: `Unknown KPI '${opts.kpiId}'. KPIs are K01 to K24 (K23 is each bet's spend line, K24 the Championship tool).` }, basis: t.basis, caveats };
    const r = kpi(data, asOf, id);
    return { value: { dataset: data.bets ? "simulated" : "original", asOf: v.asOf, bet: owner.bet_id, kpi: kpiLine(r.value, true) }, basis: [...t.basis, ...r.basis], caveats: [...new Set([...caveats, ...r.caveats])] };
  }
  const want = opts.betId?.trim().toUpperCase();
  const cards = [...v.bets, v.plan].filter((b) => !want || b.bet_id === want);
  return {
    value: {
      dataset: data.bets ? "simulated" : "original",
      asOf: v.asOf,
      hasBetData: v.hasBetData,
      bets: cards.map((b) => ({
        bet_id: b.bet_id,
        name: b.name,
        ownerTeam: b.ownerTeam,
        simulationNote: b.simulationNote,
        headline: b.headline ? `${b.headline.kpiId} ${VERDICT_LABEL[b.headline.verdict]}` : null,
        spend: b.spent == null ? null : { spentInr: b.spent, budgetInr: b.budget, overBudget: b.overBudget, inrPerModelledAttendee: b.spendPerModelled },
        kpis: b.kpis.map((k) => kpiLine(k, !!want)),
      })),
      spend: v.spend,
    },
    basis: t.basis,
    caveats,
  };
}

/** venues and sessions with seats, bookings, waitlist, offers and door attendance */
export function bookings(data: Dataset, asOf: string, opts: { venueId?: string; eventId?: string; day?: string; bookableOnly?: boolean } = {}): Result<unknown> {
  const p = programView(data, asOf);
  const v = p.value;
  const eventId = opts.eventId?.trim().toUpperCase();
  const venueId = opts.venueId?.trim().toUpperCase();
  const detail = !!(eventId || venueId);
  const venues = v.venues
    .filter((x) => !venueId || x.venue_id.toUpperCase() === venueId)
    .map((x) => ({
      ...x,
      sessions: x.sessions.filter((s) => (!eventId || s.event_id.toUpperCase() === eventId) && (!opts.day || s.day === opts.day) && (!opts.bookableOnly || s.bookingRequired)),
    }))
    .filter((x) => !eventId || x.sessions.length);
  const all = venues.flatMap((x) => x.sessions);
  const booked = all.filter((s) => s.booking && s.seatsOffered);
  const soldOut = booked.filter((s) => s.booking!.booked >= (s.seatsOffered ?? Infinity)).map((s) => s.event_id);
  const overbooked = booked.filter((s) => s.booking!.booked > (s.seatsOffered ?? Infinity)).map((s) => `${s.event_id} ${s.booking!.booked} booked for ${s.seatsOffered} seats`);
  const sessionRow = (s: (typeof all)[number]) => ({
    event_id: s.event_id,
    name: s.name,
    kind: s.kind,
    day: s.day,
    startsAt: s.startsAt,
    venue_id: s.venue_id,
    bookingRequired: s.bookingRequired,
    seatsOffered: s.seatsOffered,
    ...(s.booking ? s.booking : {}),
    ...(detail ? { sponsor: s.sponsor, notes: s.notes } : {}),
  });
  return {
    value: {
      dataset: data.bets ? "simulated" : "original",
      asOf: v.asOf,
      hasBookings: v.hasBookings,
      days: v.days,
      venues: venues.map((x) => ({ venue_id: x.venue_id, name: x.name, type: x.type, capacity: x.capacity, fillByDay: x.fillByDay, sessions: x.sessions.length })),
      sessions: (detail || opts.bookableOnly || opts.day ? all : booked.length ? booked : all).slice(0, 40).map(sessionRow),
      sessionsListed: Math.min(40, detail || opts.bookableOnly || opts.day ? all.length : booked.length || all.length),
      sessionsTotal: all.length,
      soldOut: v.hasBookings ? soldOut : null,
      overbooked: v.hasBookings ? overbooked : null,
    },
    basis: [...p.basis, "Sold out = booked at or above seats offered at the selected date."],
    caveats: [...p.caveats, ...(data.bets ? [SIM_NOTE] : [NO_BET_RECORDS])],
  };
}

/** Championship standings, Contingent Trophy and contingent tiers */
export function championshipView(data: Dataset, asOf: string, opts: { collegeId?: string; top?: number } = {}): Result<unknown> {
  const c = championship(data, asOf);
  const v = c.value;
  const want = opts.collegeId?.trim().toUpperCase();
  const top = Math.min(Math.max(opts.top ?? 10, 1), 30);
  // before any result is recorded every college has 0 points: a rank would mean nothing
  const noResults = v.available && v.resultsCount === 0;
  const rows = noResults ? [] : want ? v.standings.filter((s) => s.college_id.toUpperCase() === want) : v.standings.slice(0, top);
  let contingent: unknown = undefined;
  if (want && data.bets) {
    const b = betsAsOf(data.bets, asOf);
    const ids = new Set(b.contingents.filter((x) => text(x.college_id).toUpperCase() === want).map((x) => text(x.contingent_id)));
    const college = b.colleges.find((x) => text(x.college_id).toUpperCase() === want);
    contingent = {
      college: college ? { name: text(college.college_name), type: text(college.college_type), cluster: text(college.cluster), visitedOn: college.visited_on ?? null, signedOn: college.signed_on ?? null, ownerId: text(college.owner_id) || null } : null,
      contingents: ids.size,
      tiersReached: b.contingent_tier_events.filter((t) => ids.has(text(t.contingent_id))).map((t) => ({ milestone: numberOf(t.milestone), reachedAt: t.reached_at })),
    };
  }
  return {
    value: {
      dataset: data.bets ? "simulated" : "original",
      asOf: v.asOf,
      available: v.available,
      standings: rows,
      collegesRanked: v.standings.length,
      trophy: v.trophy,
      resultsCount: v.resultsCount,
      pointsAwarded: v.pointsAwarded,
      mismatches: v.mismatches.slice(0, 10),
      ...(contingent ? { contingent } : {}),
    },
    basis: c.basis,
    caveats: [
      ...(noResults ? ["No competition result is recorded yet at this date, so there is no ranking and no leader. Nobody can say from the data who will win."] : []),
      ...c.caveats,
      ...(data.bets ? [SIM_NOTE] : [NO_BET_RECORDS]),
    ],
  };
}

const MONEY_KPIS = ["K09", "K10", "K11", "K13", "K22"];

/** payments by kind, passes by state, exam-clash claims and refunds, plus the money KPIs */
export function money(data: Dataset, asOf: string): Result<unknown> {
  const { label } = resolveAsOf(asOf);
  if (!data.bets) {
    return { value: { dataset: "original", asOf: label, available: false }, basis: [], caveats: [NO_BET_RECORDS, "The original data has marketing spend only (daily marketing); use the campaign tools for that."] };
  }
  const b = betsAsOf(data.bets, asOf);
  const byKind: Record<string, { payments: number; amountInr: number }> = {};
  for (const p of b.payments) {
    const k = word(p.kind) || "unknown";
    const row = (byKind[k] ??= { payments: 0, amountInr: 0 });
    row.payments++;
    row.amountInr += numberOf(p.amount_inr);
  }
  const live = b.passes.filter((p) => !p.cancelled_at && !p.qr_voided_at);
  const passes = {
    known: b.passes.length,
    preBooked: b.passes.filter((p) => p.booked_at).length,
    lockedIn: b.passes.filter((p) => p.locked_in_at).length,
    cancelledOrReleased: b.passes.filter((p) => p.cancelled_at).length,
    qrVoided: b.passes.filter((p) => p.qr_voided_at).length,
    validNow: live.length,
    withHostel: live.filter((p) => text(p.hostel_name)).length,
    byType: live.reduce<Record<string, number>>((a, p) => ((a[word(p.pass_type) || "unknown"] = (a[word(p.pass_type) || "unknown"] ?? 0) + 1), a), {}),
  };
  const claims = b.insurance_claims;
  const decided = (d: string) => claims.filter((c) => word(c.decision) === d);
  const ins = {
    filed: claims.length,
    approved: decided("approved").length,
    rejected: decided("rejected").length,
    pending: decided("pending").length,
    approvedRefundsInr: decided("approved").reduce((a, c) => a + numberOf(c.refund_inr), 0),
  };
  const kpis = MONEY_KPIS.map((id) => kpiLine(kpi(data, asOf, id).value, false));
  return {
    value: { dataset: "simulated", asOf: label, paymentsByKind: byKind, passes, examClashClaims: ins, kpis },
    basis: [
      `Payments up to ${label}; amounts are signed sums per kind (a negative row reverses an earlier payment).`,
      "Payment kinds as recorded: booking = pre-booking amount, lock = lock-in balance, full = single payment, gate = paid at the gate; squad_cashback, wallet_credit and refund_exam are money given back.",
      "Valid now = known passes not cancelled and QR not voided. Claims are pending until decided.",
    ],
    caveats: [SIM_NOTE, "Pass revenue is not marketing budget. Thresholds behind the KPI verdicts are ASSUMPTIONS."],
  };
}
