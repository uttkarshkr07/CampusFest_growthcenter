// The bet tracker: every KPI in strategy/tracking_spec.md, computed from the records up to a date,
// and its Scale / Change / Stop verdict against the thresholds. Thresholds are assumptions kept in
// bet_thresholds; percentages are written there as whole numbers (55 means 55%).
import { betsAsOf, isSet, numberOf, text, word } from "./betview";
import { flags, projection, snapshot, campaignTable, type Snapshot } from "./metrics";
import { countsAsAdmission } from "./prepare";
import { isBookable, sessionBookings } from "./program";
import { DAY_MS, resolveAsOf, toMs } from "./time";
import type { BetData, BetRow, Dataset, Result } from "./types";
import type { BetTableName } from "../data/bet-spec";

export type Verdict = "scale" | "change" | "stop" | "too_early" | "not_enough_data" | "not_applicable" | "tracking";

export const VERDICT_LABEL: Record<Verdict, string> = {
  scale: "Scale",
  change: "Change",
  stop: "Stop",
  too_early: "Too early",
  not_enough_data: "Not enough data",
  not_applicable: "Not applicable",
  tracking: "Tracking",
};

export type Unit = "count" | "pct" | "points";

export interface Breakdown {
  title: string;
  columns: string[];
  rows: { id: string; cells: string[]; verdict?: Verdict; ownerId?: string }[];
}

interface Measure {
  value: number | null;
  /** how the value reads, when it is more than a number */
  display?: string;
  sample: number | null;
  sampleLabel: string;
  numbers: string[];
  breakdown?: Breakdown;
  /** the KPI does not apply at this date, with the reason */
  notApplicable?: string;
  warnings?: string[];
}

export interface Threshold {
  rowId: number | null;
  thresholdId: string;
  checkOn: string | null;
  direction: "higher" | "lower";
  scaleAt: number | null;
  stopAt: number | null;
  minSample: number | null;
  actions: { scale: string; change: string; stop: string };
}

export interface KpiResult {
  id: string;
  name: string;
  timing: string;
  unit: Unit;
  formula: string;
  verdict: Verdict;
  value: number | null;
  display: string;
  sample: number | null;
  sampleLabel: string;
  threshold: Threshold | null;
  /** the date whose data the verdict uses */
  judgedOn: string;
  /** the value at the selected date, when the verdict uses an earlier one */
  latest: string | null;
  action: string | null;
  /** why there is no verdict, or what to keep in mind */
  note: string | null;
  numbers: string[];
  breakdown: Breakdown | null;
  /** a stand-in figure, not the KPI itself */
  proxy: boolean;
  warnings: string[];
}

export interface BetCard {
  bet_id: string;
  name: string;
  ownerTeam: string | null;
  simulationNote: string | null;
  budget: number | null;
  spent: number | null;
  plannedBase: number | null;
  plannedStretch: number | null;
  /** spend to date / planned increment: modelled, because incrementality is not observed */
  spendPerModelled: number | null;
  overBudget: boolean;
  /** the verdict that leads the card: the latest lead check reached */
  headline: { kpiId: string; verdict: Verdict } | null;
  kpis: KpiResult[];
}

export interface TrackerValue {
  asOf: string;
  hasBetData: boolean;
  bets: BetCard[];
  plan: BetCard;
  spend: { bets: number | null; media: number; total: number; cap: number; over: boolean };
}

// ---------------------------------------------------------------------------
// Plan constants (strategy/slide1_model.md and bets_spec.md). All ASSUMPTIONS.
// ---------------------------------------------------------------------------
export const PLAN = {
  attendeesBase: 10521,
  attendeesStretch: 12844,
  passCap: 13000,
  mediaAndBetsCap: 1000000,
  gateRate: 0.065,
  lockDeadline: "2025-04-02",
  reserveClaimShare: 0.03,
  reserveRefundInr: 521,
};

type Route = "individual" | "squad" | "contingent";
type Rates = { prebook: number; lock: number; showup: number };
const ROUTES: Route[] = ["individual", "squad", "contingent"];
const BASE: Record<Route, Rates> = {
  individual: { prebook: 0.7, lock: 0.85, showup: 0.9 },
  squad: { prebook: 0.8, lock: 0.88, showup: 0.94 },
  contingent: { prebook: 0.85, lock: 0.92, showup: 0.92 },
};
const STRETCH: Record<Route, Rates> = {
  individual: { prebook: 0.75, lock: 0.88, showup: 0.92 },
  squad: { prebook: 0.85, lock: 0.9, showup: 0.95 },
  contingent: { prebook: 0.88, lock: 0.93, showup: 0.93 },
};
/** low = base with lock-in 10 points and show-up 8 points lower (slide 1 sensitivity) */
const lower = (r: Rates): Rates => ({ prebook: r.prebook, lock: r.lock - 0.1, showup: r.showup - 0.08 });
export const ROUTE_RATES: Record<"low" | "mid" | "high", Record<Route, Rates>> = {
  low: { individual: lower(BASE.individual), squad: lower(BASE.squad), contingent: lower(BASE.contingent) },
  mid: BASE,
  high: STRETCH,
};

/** a settings row such as k20_mid_squad_showup = 0.9 replaces one planned rate */
function plannedRates(data: Dataset) {
  const set = new Map((data.settings ?? []).map((s) => [s.key, Number(s.value)]));
  const replaced: string[] = [];
  const cases = {} as Record<"low" | "mid" | "high", Record<Route, Rates>>;
  for (const c of ["low", "mid", "high"] as const) {
    cases[c] = {} as Record<Route, Rates>;
    for (const route of ROUTES) {
      const rates = { ...ROUTE_RATES[c][route] };
      for (const k of ["prebook", "lock", "showup"] as const) {
        const key = `k20_${c}_${route}_${k}`;
        const v = set.get(key);
        if (v != null && Number.isFinite(v) && v >= 0 && v <= 1) {
          rates[k] = v;
          replaced.push(key);
        }
      }
      cases[c][route] = rates;
    }
  }
  return { cases, replaced };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const r1 = (x: number) => Math.round(x * 10) / 10;
const inr = (x: number) => `INR ${n(x)}`;
/** a percentage, exact enough for threshold comparisons */
const pctOf = (a: number, b: number) => (b > 0 ? Math.round(((100 * a) / b) * 1e6) / 1e6 : null);
const pctText = (v: number | null) => (v == null ? "n/a" : `${r1(v)}%`);
const ofText = (a: number, b: number) => `${n(a)} of ${n(b)} (${pctText(pctOf(a, b))})`;

export function judge(value: number, t: { direction: "higher" | "lower"; scaleAt: number | null; stopAt: number | null }): Verdict {
  if (t.scaleAt == null || t.stopAt == null) return "tracking";
  if (t.direction === "lower") return value <= t.scaleAt ? "scale" : value > t.stopAt ? "stop" : "change";
  return value >= t.scaleAt ? "scale" : value < t.stopAt ? "stop" : "change";
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Everything the KPIs share at one date, built once
// ---------------------------------------------------------------------------
interface Ctx {
  data: Dataset;
  asOf: string;
  ms: number;
  day: string;
  s: Snapshot;
  b: BetData;
  regs: Snapshot["personReg"];
  passesByPerson: Map<string, BetRow[]>;
  paymentsByPass: Map<string, BetRow[]>;
}

const ctxCache = new WeakMap<Dataset, Map<string, Ctx>>();
const EMPTY = new Proxy({} as BetData, { get: () => [] });

function context(data: Dataset, asOf: string): Ctx {
  let byDate = ctxCache.get(data);
  if (!byDate) ctxCache.set(data, (byDate = new Map()));
  const hit = byDate.get(asOf);
  if (hit) return hit;
  const { ms, day } = resolveAsOf(asOf);
  const s = snapshot(data, asOf);
  const b = data.bets ? betsAsOf(data.bets, asOf) : EMPTY;
  const ctx: Ctx = {
    data,
    asOf,
    ms,
    day,
    s,
    b,
    regs: s.personReg,
    passesByPerson: groupBy(b.passes, (p) => text(p.person_id)),
    paymentsByPass: groupBy(b.payments, (p) => text(p.pass_id)),
  };
  byDate.set(asOf, ctx);
  return ctx;
}

const passesOf = (c: Ctx, person: string) => c.passesByPerson.get(person) ?? [];
const isLive = (p: BetRow) => !isSet(p.cancelled_at) && !isSet(p.qr_voided_at);
/** a booking, or a full payment made at once or at the gate */
const hasPaid = (c: Ctx, person: string) =>
  passesOf(c, person).some((p) => isSet(p.booked_at) || (c.paymentsByPass.get(text(p.pass_id)) ?? []).some((x) => word(x.kind) === "full" || word(x.kind) === "gate"));
const lockedLive = (c: Ctx, person: string) => passesOf(c, person).some((p) => isSet(p.locked_in_at) && isLive(p));
const routeOf = (reg: { route?: string | null }): Route => {
  const r = word(reg.route);
  return r === "squad" || r === "contingent" ? r : "individual";
};
const eventStarted = (c: Ctx) => c.s.phase !== "pre-event";
const notYet = (sample: number, sampleLabel: string, numbers: string[]): Measure => ({ value: null, sample, sampleLabel, numbers: [...numbers, "The fest has not started at this date, so there is no attendance yet."] });
const pctMeasure = (a: number, b: number, sampleLabel: string, numbers: string[], more: Partial<Measure> = {}): Measure => ({ value: pctOf(a, b), sample: b, sampleLabel, numbers, ...more });

function contingentMembers(c: Ctx) {
  return [...c.regs].filter(([, r]) => routeOf(r) === "contingent");
}

function squadStates(c: Ctx) {
  const members = groupBy(
    [...c.regs].filter(([, r]) => routeOf(r) === "squad").map(([person, r]) => ({ person, squad: text(r.squad_id) })),
    (m) => m.squad,
  );
  return c.b.squads.map((sq) => {
    const own = (members.get(text(sq.squad_id)) ?? []).map((m) => m.person);
    const locked = own.filter((p) => lockedLive(c, p)).length;
    return { id: text(sq.squad_id), members: own, locked, full: own.length === 5 && locked === 5 };
  });
}

function twoStepBooked(c: Ctx) {
  const booked = c.b.passes.filter((p) => word(p.price_plan) === "two_step" && isSet(p.booked_at) && c.s.isExternal(text(p.person_id)));
  return { booked: booked.length, locked: booked.filter((p) => isSet(p.locked_in_at)).length };
}

const lockPace = (c: Ctx): Measure => {
  const { booked, locked } = twoStepBooked(c);
  return pctMeasure(locked, booked, "two-step pre-bookings", [`Locked in: ${ofText(locked, booked)} two-step pre-bookings.`]);
};

/** 95% interval for the difference of two shares, in points */
function gapInterval(a1: number, n1: number, a2: number, n2: number) {
  const p1 = a1 / n1;
  const p2 = a2 / n2;
  const half = 1.96 * Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const gap = p1 - p2;
  return { gap: r1(gap * 100), low: r1((gap - half) * 100), high: r1((gap + half) * 100), clear: gap - half > 0 || gap + half < 0 };
}

const TEST_ARM_MIN = 400;

// ---------------------------------------------------------------------------
// KPI definitions
// ---------------------------------------------------------------------------
interface KpiDef {
  id: string;
  name: string;
  timing: string;
  unit: Unit;
  formula: string;
  /** tables that must hold rows in this dataset */
  needs: BetTableName[];
  /** judged on the latest data from the check date on, not frozen at it */
  rolling?: boolean;
  /** what the original 2025 data can say */
  original?: "yes" | "proxy";
  measure: (c: Ctx, t: Threshold | null) => Measure;
}

export const KPIS: Record<string, KpiDef> = {
  K01: {
    id: "K01", name: "Actual attendees", timing: "lagging", unit: "count", needs: [], original: "yes",
    formula: "Distinct external people with an admitted and verified gate scan during the fest.",
    measure: (c) => {
      const target = `Plan: base ${n(PLAN.attendeesBase)}, stretch ${n(PLAN.attendeesStretch)} (assumptions).`;
      if (!eventStarted(c)) return notYet(0, "attendees", [target]);
      const got = c.s.attendees.size;
      return { value: got, sample: got, sampleLabel: "attendees", numbers: [`${n(got)} actual attendees.`, target, `${got >= PLAN.attendeesBase ? "At or above" : "Below"} base by ${n(Math.abs(got - PLAN.attendeesBase))}.`] };
    },
  },
  K02: {
    id: "K02", name: "Signed colleges", timing: "leading", unit: "count", needs: ["colleges"],
    formula: "Colleges with a signature date.",
    measure: (c) => {
      const visited = c.b.colleges.filter((x) => isSet(x.visited_on)).length;
      const signed = c.b.colleges.filter((x) => isSet(x.signed_on)).length;
      return { value: signed, sample: visited, sampleLabel: "colleges visited", numbers: [`${n(signed)} signed, ${n(visited)} visited, ${n(c.b.colleges.length)} on the list.`] };
    },
  },
  K03: {
    id: "K03", name: "Contingent registrations", timing: "leading", unit: "count", needs: ["colleges", "contingents"],
    formula: "Distinct external people whose registration came through a contingent. Applies once enough colleges are visited.",
    measure: (c) => {
      const members = contingentMembers(c).length;
      const visited = c.b.colleges.filter((x) => isSet(x.visited_on)).length;
      return { value: members, sample: visited, sampleLabel: "colleges visited", numbers: [`${n(members)} people registered through ${n(c.b.contingents.length)} contingents. ${n(visited)} colleges visited.`] };
    },
  },
  K04: {
    id: "K04", name: "Per-college health: paid pre-book rate", timing: "leading, weekly", unit: "pct", needs: ["contingents", "passes"], rolling: true,
    formula: "Contingent members who have paid / contingent registrations, per college.",
    measure: (c, t) => {
      const byContingent = groupBy(contingentMembers(c), ([, r]) => text(r.contingent_id));
      const college = new Map(c.b.colleges.map((x) => [text(x.college_id), x]));
      const tiers = groupBy(c.b.contingent_tier_events, (x) => text(x.contingent_id));
      let members = 0;
      let paid = 0;
      const rows = c.b.contingents.map((k) => {
        const own = byContingent.get(text(k.contingent_id)) ?? [];
        const own_paid = own.filter(([p]) => hasPaid(c, p)).length;
        const locked = own.filter(([p]) => lockedLive(c, p)).length;
        members += own.length;
        paid += own_paid;
        const rate = pctOf(own_paid, own.length);
        const tier = Math.max(0, ...(tiers.get(text(k.contingent_id)) ?? []).map((x) => numberOf(x.milestone)));
        const school = college.get(text(k.college_id));
        const enough = own.length >= (t?.minSample ?? 30);
        return {
          rate,
          row: {
            id: text(k.college_id),
            ownerId: text(school?.owner_id) || undefined,
            verdict: (enough && rate != null && t ? judge(rate, t) : "not_enough_data") as Verdict,
            cells: [text(school?.college_name) || text(k.college_id), n(own.length), pctText(rate), n(locked), tier ? String(tier) : "none"],
          },
        };
      });
      rows.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));
      return pctMeasure(paid, members, "contingent members", [`Paid: ${ofText(paid, members)} contingent members.`], {
        breakdown: { title: "By college, weakest first", columns: ["College", "Registered", "Paid", "Locked in", "Tier reached"], rows: rows.map((x) => x.row) },
      });
    },
  },
  K05: {
    id: "K05", name: "Contingent show-up", timing: "lagging", unit: "pct", needs: ["contingents", "passes"], original: "proxy",
    formula: "Attended / locked-in, contingent route.",
    measure: (c) => {
      const locked = contingentMembers(c).filter(([p]) => lockedLive(c, p));
      if (!eventStarted(c)) return notYet(locked.length, "locked-in contingent members", [`${n(locked.length)} contingent members locked in.`]);
      const came = locked.filter(([p]) => c.s.attendees.has(p)).length;
      return pctMeasure(came, locked.length, "locked-in contingent members", [`Attended: ${ofText(came, locked.length)} locked-in contingent members.`]);
    },
  },
  K06: {
    id: "K06", name: "Squad share", timing: "leading", unit: "pct", needs: ["squads"],
    formula: "Squad registrations / (individual + squad registrations).",
    measure: (c) => {
      const routes = [...c.regs.values()].map(routeOf);
      const squad = routes.filter((r) => r === "squad").length;
      const base = squad + routes.filter((r) => r === "individual").length;
      return pctMeasure(squad, base, "individual and squad registrations", [`Squad route: ${ofText(squad, base)} non-contingent registrations.`]);
    },
  },
  K07: {
    id: "K07", name: "Squads fully locked in", timing: "leading", unit: "pct", needs: ["squads", "passes"],
    formula: "Squads with 5 members all locked in and not cancelled / squads created.",
    measure: (c) => {
      const states = squadStates(c);
      const full = states.filter((x) => x.full).length;
      return pctMeasure(full, states.length, "squads created", [`Fully locked: ${ofText(full, states.length)} squads.`], {
        breakdown: { title: "Squads by members locked in", columns: ["Members locked", "Squads"], rows: [0, 1, 2, 3, 4, 5].map((k) => ({ id: String(k), cells: [String(k), n(states.filter((x) => Math.min(x.locked, 5) === k).length)] })) },
      });
    },
  },
  K08: {
    id: "K08", name: "Full-squad arrival and cashback", timing: "lagging", unit: "pct", needs: ["squads", "passes"],
    formula: "Squads with all 5 attended / fully locked squads. Cashback is due only when all 5 qualify at the gate.",
    measure: (c) => {
      const states = squadStates(c);
      const full = states.filter((x) => x.full);
      const arrived = new Set(states.filter((x) => x.members.length === 5 && x.members.every((p) => c.s.attendees.has(p))).map((x) => x.id));
      const squadOfPass = new Map<string, string>();
      for (const x of states) for (const person of x.members) for (const p of passesOf(c, person)) squadOfPass.set(text(p.pass_id), x.id);
      const cashback = c.b.payments.filter((p) => word(p.kind) === "squad_cashback");
      const paid = cashback.reduce((a, p) => a + Math.abs(numberOf(p.amount_inr)), 0);
      const wrong = cashback.filter((p) => !arrived.has(squadOfPass.get(text(p.pass_id)) ?? ""));
      const warnings = wrong.length ? [`Anomaly: ${n(wrong.length)} cashback payment(s) go to a pass whose squad does not have 5 qualifying scans.`] : [];
      const numbers = [`Cashback paid: ${inr(paid)} in ${n(cashback.length)} payment(s).`, "Plan: 70% of squad attendees in complete squads (assumption)."];
      if (!eventStarted(c)) return { ...notYet(full.length, "fully locked squads", numbers), warnings };
      const came = full.filter((x) => arrived.has(x.id)).length;
      return pctMeasure(came, full.length, "fully locked squads", [`All five attended: ${ofText(came, full.length)} fully locked squads.`, ...numbers], { warnings });
    },
  },
  K09: {
    id: "K09", name: "Pre-book rate", timing: "leading", unit: "pct", needs: ["passes"],
    formula: "Registrations with a booking or a full payment / registrations at least 7 days old.",
    measure: (c) => {
      const old = [...c.regs].filter(([, r]) => r.ms <= c.ms - 7 * DAY_MS);
      const paid = old.filter(([p]) => hasPaid(c, p));
      return pctMeasure(paid.length, old.length, "registrations 7 days old or more", [`Paid: ${ofText(paid.length, old.length)} registrations at least 7 days old.`], {
        breakdown: {
          title: "By route",
          columns: ["Route", "Registrations", "Paid", "Rate"],
          rows: ROUTES.map((route) => {
            const own = old.filter(([, r]) => routeOf(r) === route);
            const got = own.filter(([p]) => hasPaid(c, p)).length;
            return { id: route, cells: [route, n(own.length), n(got), pctText(pctOf(got, own.length))] };
          }),
        },
      });
    },
  },
  K10: { id: "K10", name: "Lock-in pace", timing: "leading", unit: "pct", needs: ["passes"], formula: "Locked in / pre-booked, two-step passes only.", measure: lockPace },
  K11: { id: "K11", name: "Lock-in rate at the deadline", timing: "leading", unit: "pct", needs: ["passes"], formula: "Locked in / pre-booked, two-step passes only, at the 2 Apr deadline. Plan 88.9%.", measure: lockPace },
  K12: {
    id: "K12", name: "Two-step test", timing: "leading then lagging", unit: "points", needs: ["passes"],
    formula: "Per arm: paid anything / assigned, then attended / assigned. Gap = two-step minus single payment, with a 95% interval.",
    measure: (c, t) => {
      const assigned = [...c.regs].filter(([, r]) => word(r.test_name) === "two_step" && word(r.test_arm) !== "");
      const arms = [...groupBy(assigned, ([, r]) => word(r.test_arm))].map(([arm, rows]) => {
        const plans = rows.flatMap(([p]) => passesOf(c, p).map((x) => word(x.price_plan)));
        const two = plans.filter((x) => x === "two_step").length;
        const single = plans.filter((x) => x === "single").length;
        return { arm, people: rows.map(([p]) => p), twoStepShare: two + single ? two / (two + single) : null };
      });
      const need = t?.minSample ?? TEST_ARM_MIN;
      const label = "people in the smaller arm";
      // which arm is two-step is read from the passes its members bought, not from the arm's name
      const [a, b] = [...arms].sort((x, y) => (y.twoStepShare ?? -1) - (x.twoStepShare ?? -1));
      if (!a || !b || a.twoStepShare == null || b.twoStepShare == null || a.twoStepShare === b.twoStepShare)
        return { value: null, sample: 0, sampleLabel: label, numbers: ["Two arms with different price plans cannot be told apart yet."] };
      const smaller = Math.min(a.people.length, b.people.length);
      const outcomes = [{ name: "Paid anything", has: (p: string) => hasPaid(c, p) }, ...(eventStarted(c) ? [{ name: "Attended", has: (p: string) => c.s.attendees.has(p) }] : [])].map((o) => {
        const x = a.people.filter(o.has).length;
        const y = b.people.filter(o.has).length;
        return { name: o.name, x, y, ci: gapInterval(x, a.people.length, y, b.people.length) };
      });
      const lead = outcomes[outcomes.length - 1];
      const readable = smaller >= need && lead.ci.clear;
      return {
        value: lead.ci.gap,
        display: `${lead.ci.gap > 0 ? "+" : ""}${lead.ci.gap} points (${lead.name.toLowerCase()}): ${readable ? "readable" : "not readable"}`,
        sample: smaller,
        sampleLabel: label,
        numbers: outcomes.map(
          (o) =>
            `${o.name}: two-step arm (${a.arm}) ${ofText(o.x, a.people.length)}, single-payment arm (${b.arm}) ${ofText(o.y, b.people.length)}. Gap ${o.ci.gap} points, 95% interval ${o.ci.low} to ${o.ci.high}${o.ci.clear ? "" : ", which includes 0: not readable"}.`,
        ),
      };
    },
  },
  K13: {
    id: "K13", name: "Exam-claim rate and reserve", timing: "leading", unit: "pct", needs: ["passes", "insurance_claims"],
    formula: "Passes with a claim filed / locked-in passes. Reserve = 3% x locked-in x INR 521.",
    measure: (c) => {
      const locked = c.b.passes.filter((p) => isSet(p.locked_in_at));
      const ids = new Set(locked.map((p) => text(p.pass_id)));
      const filed = new Set(c.b.insurance_claims.map((x) => text(x.pass_id)).filter((id) => ids.has(id))).size;
      const refunds = c.b.insurance_claims.filter((x) => word(x.decision) === "approved").reduce((a, x) => a + Math.abs(numberOf(x.refund_inr)), 0);
      const reserve = PLAN.reserveClaimShare * locked.length * PLAN.reserveRefundInr;
      return pctMeasure(filed, locked.length, "locked-in passes", [`Claims filed: ${ofText(filed, locked.length)} locked-in passes.`, `Approved refunds ${inr(refunds)} against a reserve of ${inr(reserve)}.`], {
        warnings: refunds > reserve ? ["Approved refunds are above the reserve."] : [],
      });
    },
  },
  K14: {
    id: "K14", name: "Locked-in show-up and gate rescue", timing: "lagging", unit: "pct", needs: ["passes"], original: "proxy",
    formula: "Attended / locked-in and not voided. Gate rescue = people with a denied or pending scan who later got a qualifying scan.",
    measure: (c) => {
      const locked = [...new Set(c.b.passes.filter((p) => isSet(p.locked_in_at) && !isSet(p.qr_voided_at) && c.s.isExternal(text(p.person_id))).map((p) => text(p.person_id)))];
      if (!eventStarted(c)) return notYet(locked.length, "locked-in people", [`${n(locked.length)} people locked in and not voided.`]);
      const came = locked.filter((p) => c.s.attendees.has(p)).length;
      const troubled = new Map<string, number>();
      for (const scan of c.s.p.checkins) {
        if (scan.ms > c.ms || !c.s.isExternal(scan.person_id) || (scan.result !== "denied" && scan.result !== "pending")) continue;
        troubled.set(scan.person_id, Math.min(troubled.get(scan.person_id) ?? Infinity, scan.ms));
      }
      const rescued = new Set(c.s.p.checkins.filter((x) => x.ms <= c.ms && countsAsAdmission(x) && x.ms >= (troubled.get(x.person_id) ?? Infinity)).map((x) => x.person_id)).size;
      return pctMeasure(came, locked.length, "locked-in people", [`Attended: ${ofText(came, locked.length)} locked-in people. Plan about 90% to 94% by route.`, `Gate rescue: ${ofText(rescued, troubled.size)} people with a denied or pending scan.`]);
    },
  },
  K15: {
    id: "K15", name: "Claim rate of released seats", timing: "leading", unit: "pct", needs: ["exchange_offers"], rolling: true,
    formula: "Offers claimed within 10 minutes / offers that ended (claimed or expired). One seat may produce several offers.",
    measure: (c) => {
      const ended = c.b.exchange_offers.filter((o) => isSet(o.claimed_at) || isSet(o.expired_at));
      const minutes = (o: BetRow) => (toMs(text(o.claimed_at)) - toMs(text(o.offered_at))) / 60000;
      const quick = ended.filter((o) => isSet(o.claimed_at) && minutes(o) <= 10);
      const times = quick.map(minutes).sort((a, b) => a - b);
      const median = times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.ceil((times.length - 1) / 2)]) / 2 : null;
      return pctMeasure(quick.length, ended.length, "offers that ended", [
        `Claimed in time: ${ofText(quick.length, ended.length)} ended offers. ${n(c.b.exchange_offers.length - ended.length)} still open.`,
        median == null ? "No claim yet." : `Median time to claim: ${r1(median)} minutes. This is a before-and-after reading, not proof of cause.`,
      ]);
    },
  },
  K16: {
    id: "K16", name: "Seat fill of finished sessions", timing: "leading then lagging", unit: "pct", needs: ["program_events", "seat_booking_history"], rolling: true,
    formula: "People admitted at the session door / seats offered, over sessions that have ended.",
    measure: (c) => {
      const booking = sessionBookings(c.b, c.ms);
      const sessions = c.b.program_events.filter(isBookable).map((e) => ({ e, id: text(e.event_id), seats: numberOf(e.seats_offered), f: booking.get(text(e.event_id))!, done: toMs(text(e.ends_at)) <= c.ms }));
      const done = sessions.filter((x) => x.done);
      const admitted = done.reduce((a, x) => a + (x.f.attended ?? 0), 0);
      const seats = done.reduce((a, x) => a + x.seats, 0);
      const sum = (f: (x: (typeof sessions)[number]) => number) => sessions.reduce((a, x) => a + f(x), 0);
      return {
        value: pctOf(admitted, seats),
        sample: done.length,
        sampleLabel: "finished sessions",
        numbers: [
          `Booked now: ${n(sum((x) => x.f.booked))} of ${n(sum((x) => x.seats))} seats in ${n(sessions.length)} bookable sessions. Waiting: ${n(sum((x) => x.f.waiting))}.`,
          done.length ? `Admitted ${n(admitted)} of ${n(seats)} seats in finished sessions. Turnaways: ${n(sum((x) => x.f.turnaways ?? 0))}.` : "No bookable session has finished yet.",
        ],
        breakdown: {
          title: "By session, most waiting first",
          columns: ["Session", "Booked", "Seats", "Waiting", "Admitted", "Turnaways"],
          rows: [...sessions]
            .sort((a, b) => b.f.waiting - a.f.waiting || b.f.booked / b.seats - a.f.booked / a.seats)
            .map((x) => ({ id: x.id, cells: [text(x.e.event_name), n(x.f.booked), n(x.seats), n(x.f.waiting), x.f.attended == null ? "not yet" : n(x.f.attended), x.f.turnaways == null ? "not yet" : n(x.f.turnaways)] })),
        },
      };
    },
  },
  K17: {
    id: "K17", name: "Passes resold", timing: "lagging", unit: "pct", needs: ["passes"], rolling: true,
    formula: "Cancelled or voided passes refilled / cancelled or voided. Applies only once 95% of the pass cap is sold.",
    measure: (c) => {
      const sold = c.b.passes.filter((p) => c.s.isExternal(text(p.person_id)));
      const valid = sold.filter(isLive).length;
      const out = sold.filter((p) => !isLive(p));
      const needed = Math.ceil(0.95 * PLAN.passCap);
      // reached when enough passes are valid, or the paid pass waitlist (opened only at that point) has been used
      const reached = valid >= needed || c.b.waitlist_entries.some((w) => word(w.kind) === "pass") || c.b.exchange_offers.some((o) => word(o.kind) === "pass");
      if (!reached) return { value: null, sample: out.length, sampleLabel: "cancelled or voided passes", numbers: [`${n(valid)} valid passes; the paid waitlist applies from ${n(needed)}.`], notApplicable: `The pass cap has not been reached: ${n(valid)} valid passes of the ${n(needed)} needed.` };
      const refilled = new Set([
        ...c.b.exchange_offers.filter((o) => isSet(o.claimed_at) && isSet(o.new_pass_id)).map((o) => text(o.source_pass_id)),
        ...c.b.payments.filter((p) => word(p.kind) === "refund_resale").map((p) => text(p.pass_id)),
      ]);
      const back = out.filter((p) => refilled.has(text(p.pass_id))).length;
      return pctMeasure(back, out.length, "cancelled or voided passes", [`Refilled: ${ofText(back, out.length)} cancelled or voided passes. Plan 60% of voided passes (assumption).`]);
    },
  },
  K18: {
    id: "K18", name: "Hackathon written approval", timing: "leading", unit: "count", needs: ["bet_milestones"],
    formula: "The approval milestone done by its due date.",
    measure: (c) => {
      const m = c.b.bet_milestones.find((x) => text(x.bet_id) === "B5" && /approv/i.test(text(x.milestone)));
      if (!m) return { value: null, sample: null, sampleLabel: "", numbers: [], notApplicable: "No approval milestone is recorded for the hackathon." };
      const done = text(m.done_on).slice(0, 10);
      return { value: done && done <= text(m.due_on).slice(0, 10) ? 1 : 0, display: done ? `done ${done}` : "not done", sample: null, sampleLabel: "", numbers: [`${text(m.milestone)}: due ${text(m.due_on).slice(0, 10)}, ${done ? `done ${done}` : "not done at this date"}.`] };
    },
  },
  K19: {
    id: "K19", name: "Hackathon teams and new people", timing: "leading", unit: "count", needs: ["hackathon_teams", "hackathon_members"],
    formula: "Registered teams; participants with no earlier fest registration / participants.",
    measure: (c) => {
      const teams = new Map(c.b.hackathon_teams.filter((x) => word(x.status) !== "withdrawn").map((x) => [text(x.team_id), x]));
      const members = c.b.hackathon_members.filter((m) => teams.has(text(m.team_id)));
      const fresh = members.filter((m) => {
        const reg = c.regs.get(text(m.person_id));
        return !reg || reg.ms >= toMs(text(teams.get(text(m.team_id))!.registered_at));
      }).length;
      return { value: teams.size, sample: teams.size, sampleLabel: "teams", numbers: [`${n(teams.size)} teams registered.`, `New to the fest: ${ofText(fresh, members.length)} participants. Plan 70% (assumption).`], warnings: ["Team status has no history, so a later withdrawal also removes the team from earlier dates."] };
    },
  },
  K20: {
    id: "K20", name: "Projected attendees", timing: "leading", unit: "count", needs: ["passes"], rolling: true, original: "yes",
    formula: "Per route: locked-in x show-up + pre-booked x lock-in x show-up + unpaid x pre-book x lock-in x show-up (unlocked terms are zero after 2 Apr), plus 6.5% gate buyers and new hackathon participants, capped at 13,000. A cancelled registration with no live pass is left out.",
    measure: (c) => {
      const { cases, replaced } = plannedRates(c.data);
      const open = c.day <= PLAN.lockDeadline;
      const counts = Object.fromEntries(ROUTES.map((r) => [r, { locked: 0, booked: 0, unpaid: 0 }])) as Record<Route, { locked: number; booked: number; unpaid: number }>;
      let cancelled = 0;
      for (const [person, reg] of c.regs) {
        const own = passesOf(c, person);
        const live = own.filter(isLive);
        if (own.length && !live.length) continue; // cancelled or voided: not expected
        // with no pass, the registration status at this date is the only sign of a cancellation
        if (!live.length && word(c.s.statusOf(reg.registration_id, c.ms)?.status) === "cancelled") {
          cancelled++;
          continue;
        }
        const at = counts[routeOf(reg)];
        if (live.some((p) => isSet(p.locked_in_at))) at.locked++;
        else if (live.length) at.booked++;
        else at.unpaid++;
      }
      const hack = new Set(c.b.hackathon_teams.filter((x) => word(x.status) !== "withdrawn").map((x) => text(x.team_id)));
      const newHack = new Set(c.b.hackathon_members.filter((m) => hack.has(text(m.team_id)) && !c.regs.has(text(m.person_id))).map((m) => text(m.person_id))).size;
      const project = (k: "low" | "mid" | "high") => {
        const base = ROUTES.reduce((sum, route) => {
          const x = counts[route];
          const q = cases[k][route];
          return sum + x.locked * q.showup + (open ? x.booked * q.lock * q.showup + x.unpaid * q.prebook * q.lock * q.showup : 0);
        }, 0);
        return Math.min(PLAN.passCap, Math.round(base * (1 + PLAN.gateRate) + newHack));
      };
      const [low, mid, high] = [project("low"), project("mid"), project("high")];
      const numbers = [
        ...ROUTES.map((r) => `${r}: ${n(counts[r].locked)} locked in, ${n(counts[r].booked)} pre-booked only, ${n(counts[r].unpaid)} registered and unpaid.`),
        `Projection ${n(mid)} (low ${n(low)}, high ${n(high)}) against the base target ${n(PLAN.attendeesBase)}. Includes ${n(newHack)} new hackathon participants.`,
        ...(cancelled ? [`Left out: ${n(cancelled)} cancelled registration(s) with no pass.`] : []),
        ...(replaced.length ? [`Settings replace these planned rates: ${replaced.join(", ")}.`] : []),
      ];
      if (eventStarted(c)) numbers.push(`Actual attendees so far: ${n(c.s.attendees.size)}.`);
      return {
        value: mid,
        display: `${n(mid)} (${n(low)} to ${n(high)})`,
        sample: c.regs.size,
        sampleLabel: "registrations",
        numbers,
        warnings: [...(eventStarted(c) ? [] : ["This projects current sign-ups only; later registrations are not included."]), "The route rates are planned ASSUMPTIONS, not observed rates."],
      };
    },
  },
  K21: {
    id: "K21", name: "Channel efficiency", timing: "leading, lagging after the fest", unit: "count", needs: [], rolling: true, original: "yes",
    formula: "INR per confirmed registrant before the fest, per actual attendee after, against the blend (the Campaigns page rule).",
    measure: (c) => {
      if (c.data.bets && c.day < "2025-03-15") return { value: null, sample: 0, sampleLabel: "", numbers: ["In this run people become confirmed mostly near lock-in, so cost per confirmed means little before 15 Mar."] };
      const list = flags(c.data, c.asOf).value.flags;
      const count = (level: string) => list.filter((f) => f.level === level).length;
      return {
        value: count("stop"),
        display: `${count("scale")} scale, ${count("watch")} watch, ${count("stop")} stop`,
        sample: null,
        sampleLabel: "",
        numbers: ["Each campaign needs the minimum sample set in Settings."],
        breakdown: { title: "By campaign", columns: ["Campaign", "Flag", "Reason"], rows: list.map((f) => ({ id: f.campaign_id, cells: [f.campaign_name, f.level, f.reason] })) },
      };
    },
  },
  K22: {
    id: "K22", name: "Revenue givebacks", timing: "leading", unit: "pct", needs: ["payments", "passes"], rolling: true,
    formula: "(cashback + contingent discount from lock-in + wallet credit + exam refunds) / gross pass payments. A reversal is a negative amount and cancels the payment it reverses.",
    measure: (c) => {
      const sumOf = (kinds: string[]) => c.b.payments.filter((p) => kinds.includes(word(p.kind))).reduce((a, p) => a + numberOf(p.amount_inr), 0);
      const grossKinds = ["booking", "lock", "full", "gate"];
      const gross = sumOf(grossKinds);
      const paidPasses = new Set(c.b.payments.filter((p) => grossKinds.includes(word(p.kind))).map((p) => text(p.pass_id)));
      // the discount is granted when the pass locks in, not when it is first booked
      const discount = c.b.passes.filter((p) => word(p.discount_type) === "contingent_25" && isSet(p.locked_in_at)).reduce((a, p) => a + numberOf(p.discount_inr), 0);
      const parts = { cashback: sumOf(["squad_cashback"]), "contingent discount": discount, "wallet credit": sumOf(["wallet_credit"]), "exam refunds": sumOf(["refund_exam"]) };
      const back = Object.values(parts).reduce((a, x) => a + x, 0);
      return {
        value: pctOf(back, gross),
        sample: paidPasses.size,
        sampleLabel: "paid passes",
        numbers: [`Givebacks ${inr(back)} of ${inr(gross)} gross pass payments.`, Object.entries(parts).map(([k, v]) => `${k} ${inr(v)}`).join(", ") + "."],
      };
    },
  },
};

export const BET_DEFS: { bet_id: string; name: string; kpis: string[]; lead: string[] }[] = [
  { bet_id: "B1", name: "College contingents and Championship", kpis: ["K02", "K03", "K04", "K05"], lead: ["K02", "K03"] },
  { bet_id: "B2", name: "Squad Pass", kpis: ["K06", "K07", "K08"], lead: ["K06", "K07"] },
  { bet_id: "B3", name: "Two-step payment, early perks and exam-clash insurance", kpis: ["K09", "K10", "K11", "K12", "K13", "K14"], lead: ["K09", "K10", "K11"] },
  { bet_id: "B4", name: "Attendance Exchange", kpis: ["K15", "K16", "K17"], lead: ["K15"] },
  { bet_id: "B5", name: "RISA AI x Health Hackathon", kpis: ["K18", "K19"], lead: ["K18", "K19"] },
];
export const PLAN_CARD = { bet_id: "PLAN", name: "Whole plan", kpis: ["K01", "K20", "K21", "K22"], lead: ["K20"] };

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------
const toThreshold = (row: BetRow): Threshold => ({
  rowId: typeof row._row_id === "number" ? row._row_id : null,
  thresholdId: text(row.threshold_id),
  checkOn: text(row.check_on).slice(0, 10) || null,
  direction: word(row.direction) === "lower" ? "lower" : "higher",
  scaleAt: isSet(row.scale_at) ? numberOf(row.scale_at) : null,
  stopAt: isSet(row.stop_at) ? numberOf(row.stop_at) : null,
  minSample: isSet(row.min_sample) ? numberOf(row.min_sample) : null,
  actions: { scale: text(row.action_scale), change: text(row.action_change), stop: text(row.action_stop) },
});

/** the latest check date reached, or the first one still to come */
function thresholdFor(data: Dataset, kpiId: string, day: string): Threshold | null {
  const rows = (data.bets?.bet_thresholds ?? [])
    .filter((r) => !r._deleted && text(r.kpi_id) === kpiId)
    .map(toThreshold)
    .sort((a, b) => (a.checkOn ?? "").localeCompare(b.checkOn ?? ""));
  return [...rows].reverse().find((r) => !r.checkOn || r.checkOn <= day) ?? rows[0] ?? null;
}

const asText = (def: KpiDef, m: Measure) => m.display ?? (m.value == null ? "n/a" : def.unit === "pct" ? pctText(m.value) : def.unit === "points" ? `${r1(m.value)} points` : n(m.value));

function originalProxy(data: Dataset, asOf: string, id: string): Measure | null {
  const s = snapshot(data, asOf);
  if (s.phase === "pre-event") return notYet(0, "registrations", []);
  if (id === "K14") {
    const confirmed = [...s.personReg].filter(([, r]) => word(s.statusOf(r.registration_id, s.statusMs)?.status) === "confirmed");
    const came = confirmed.filter(([p]) => s.attendees.has(p)).length;
    return pctMeasure(came, confirmed.length, "confirmed registrants", [`Attended: ${ofText(came, confirmed.length)} people confirmed at the start of the fest.`]);
  }
  const rows = campaignTable(data, asOf).value.rows.filter((r) => /college/i.test(`${r.channel} ${r.campaign_name}`));
  const registered = rows.reduce((a, r) => a + r.registered, 0);
  if (!registered) return null;
  const came = rows.reduce((a, r) => a + (r.attended ?? 0), 0);
  return pctMeasure(came, registered, "registrations", [`${rows.map((r) => r.campaign_name).join(", ")}: ${ofText(came, registered)} registrants attended. These are channel registrants, not contingents.`]);
}

function originalProjection(data: Dataset, asOf: string): Measure {
  const p = projection(data, asOf);
  const v = p.value;
  const actual = v.actual != null;
  return {
    value: actual ? v.actual : v.mid,
    display: actual ? `${n(v.actual!)} actual` : `${n(v.mid)} (${n(v.low)} to ${n(v.high)})`,
    sample: v.confirmedNow,
    sampleLabel: "confirmed registrants",
    numbers: [
      actual ? `The day-before projection was ${n(v.mid)}; ${n(v.actual!)} attended.` : `Existing method: ${n(v.confirmedNow)} confirmed x the Settings show-up rates, plus expected walk-ins.`,
      `The base target for the new plan is ${n(PLAN.attendeesBase)}.`,
    ],
    warnings: p.caveats,
  };
}

export function kpi(data: Dataset, asOf: string, id: string): Result<KpiResult> {
  const def = KPIS[id];
  if (!def) throw new Error(`Unknown KPI '${id}'.`);
  const { day, label } = resolveAsOf(asOf);
  const t = thresholdFor(data, id, day);
  const shell: KpiResult = {
    id, name: def.name, timing: def.timing, unit: def.unit, formula: def.formula,
    verdict: "not_applicable", value: null, display: "n/a", sample: null, sampleLabel: "",
    threshold: t, judgedOn: day, latest: null, action: null, note: null, numbers: [], breakdown: null, proxy: false, warnings: [],
  };
  const done = (over: Partial<KpiResult>): Result<KpiResult> => {
    const value = { ...shell, ...over };
    return {
      value,
      basis: [def.formula, `Only records up to ${value.judgedOn === day ? label : `end of ${value.judgedOn} IST (the check date)`} are used for the verdict.`],
      caveats: [...value.warnings, ...(value.note ? [value.note] : []), ...(value.threshold ? ["Thresholds, check dates and minimum samples are ASSUMPTIONS."] : [])],
    };
  };
  const shown = (m: Measure): Partial<KpiResult> => ({ value: m.value, display: asText(def, m), sample: m.sample, sampleLabel: m.sampleLabel, numbers: m.numbers, breakdown: m.breakdown ?? null, warnings: m.warnings ?? [] });

  if (!data.bets) {
    if (!def.original) return done({ note: "The original 2025 data has no records for this: no contingents, squads, payments, passes, seats or bet records exist in it.", threshold: null });
    if (def.original === "proxy") {
      const m = originalProxy(data, asOf, id);
      if (!m) return done({ note: "The original 2025 data has no records for this.", threshold: null });
      return done({ ...shown(m), verdict: m.value == null ? "too_early" : "tracking", proxy: true, threshold: null, note: "Proxy from the original data: it is not this KPI, so there is no verdict." });
    }
    if (id === "K20") return done({ ...shown(originalProjection(data, asOf)), verdict: "tracking", threshold: null });
  } else if (def.needs.some((table) => !data.bets![table]?.length)) {
    return done({ note: "The tables this needs are empty in this dataset." });
  }

  const now = def.measure(context(data, asOf), t);
  if (id === "K18") {
    // judged at the due date: done by then is Scale, anything else is Stop
    const m = data.bets!.bet_milestones.find((x) => text(x.bet_id) === "B5" && /approv/i.test(text(x.milestone)));
    if (now.notApplicable || !m) return done({ ...shown(now), note: now.notApplicable ?? null });
    const due = text(m.due_on).slice(0, 10);
    const verdict: Verdict = day < due ? "too_early" : now.value === 1 ? "scale" : "stop";
    return done({ ...shown(now), verdict, judgedOn: day < due ? day : due, action: verdict === "scale" ? t?.actions.scale || null : verdict === "stop" ? t?.actions.stop || null : null, note: day < due ? `Judged on ${due}.` : null });
  }

  const early = !!t?.checkOn && day < t.checkOn;
  const frozen = !early && !def.rolling && !!t?.checkOn && t.checkOn < day;
  const m = frozen ? def.measure(context(data, t!.checkOn!), t) : now;
  const base: Partial<KpiResult> = { ...shown(m), judgedOn: frozen ? t!.checkOn! : day, latest: frozen ? asText(def, now) : null };
  if (m.notApplicable) return done({ ...base, note: m.notApplicable });
  if (id === "K12") {
    const checkOn = t?.checkOn ?? "2025-03-02";
    const need = t?.minSample ?? TEST_ARM_MIN;
    if (day < checkOn) return done({ ...base, verdict: "too_early", note: `Early read on ${checkOn}; final read after the fest.` });
    if ((m.sample ?? 0) < need) return done({ ...base, verdict: "not_enough_data", note: `Needs ${n(need)} people in each arm.` });
    return done({ ...base, verdict: "tracking", action: "Keep two-step unless the single-payment arm is clearly better." });
  }
  if (early) return done({ ...base, verdict: "too_early", note: `First judged on ${t!.checkOn}.${m.value == null ? "" : " The value shown is the value so far."}` });
  if (t?.minSample != null && m.sample != null && m.sample < t.minSample) return done({ ...base, verdict: "not_enough_data", note: `Needs at least ${n(t.minSample)} ${m.sampleLabel}; there are ${n(m.sample)}.` });
  if (id === "K01" && m.value == null) return done({ ...base, verdict: "too_early" });
  if (id === "K21" && data.bets && m.value == null) return done({ ...base, verdict: "not_enough_data" });
  if (!t || t.scaleAt == null || t.stopAt == null) return done({ ...base, verdict: m.value == null && id !== "K21" ? "too_early" : "tracking", note: data.bets && !["K01", "K08", "K17", "K20", "K21"].includes(id) ? "No threshold row exists for this KPI." : null });
  if (m.value == null) return done({ ...base, verdict: "not_enough_data" });
  const verdict = judge(m.value, t);
  const action = verdict === "scale" || verdict === "change" || verdict === "stop" ? t.actions[verdict] || null : null;
  return done({ ...base, verdict, action });
}

function card(data: Dataset, asOf: string, def: (typeof BET_DEFS)[number]): BetCard {
  const { day } = resolveAsOf(asOf);
  const bets = data.bets && context(data, asOf).b;
  const row = bets?.bets.find((x) => text(x.bet_id) === def.bet_id);
  const spendRows = bets?.bet_spend.filter((x) => text(x.bet_id) === def.bet_id);
  const spent = spendRows ? spendRows.reduce((a, x) => a + numberOf(x.amount_inr), 0) : null;
  const budget = row && isSet(row.budget_inr) ? numberOf(row.budget_inr) : null;
  const planned = row && isSet(row.planned_increment_base) ? numberOf(row.planned_increment_base) : null;
  const kpis = def.kpis.map((id) => kpi(data, asOf, id).value);
  // of the lead checks, the one whose check date came last speaks for the bet
  const leads = kpis.filter((k) => def.lead.includes(k.id) && k.verdict !== "not_applicable");
  const dueOf = (k: KpiResult) => k.threshold?.checkOn ?? k.judgedOn;
  const reached = leads.filter((k) => k.verdict !== "too_early" && dueOf(k) <= day).sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
  const lead = reached[reached.length - 1] ?? leads[0] ?? null;
  return {
    bet_id: def.bet_id,
    name: text(row?.bet_name) || def.name,
    ownerTeam: text(row?.owner_team) || null,
    simulationNote: text(row?.simulation_note) || (def.bet_id === "B5" ? "SIMULATED SCENARIO: RISA Labs has not agreed to this." : null),
    budget,
    spent,
    plannedBase: planned,
    plannedStretch: row && isSet(row.planned_increment_stretch) ? numberOf(row.planned_increment_stretch) : null,
    spendPerModelled: spent != null && planned ? Math.round(spent / planned) : null,
    overBudget: spent != null && budget != null && spent > budget,
    headline: lead ? { kpiId: lead.id, verdict: lead.verdict } : null,
    kpis,
  };
}

export function betTracker(data: Dataset, asOf: string): Result<TrackerValue> {
  const { label } = resolveAsOf(asOf);
  const bets = BET_DEFS.map((d) => card(data, asOf, d));
  const plan = card(data, asOf, PLAN_CARD);
  const betSpend = data.bets ? bets.reduce((a, b) => a + (b.spent ?? 0), 0) : null;
  const media = campaignTable(data, asOf).value.totals.spend;
  const total = media + (betSpend ?? 0);
  return {
    value: { asOf: label, hasBetData: !!data.bets, bets, plan, spend: { bets: betSpend, media, total, cap: PLAN.mediaAndBetsCap, over: !!data.bets && total > PLAN.mediaAndBetsCap } },
    basis: [
      "As-of = end of the selected day in IST. A record, or a later change to it, counts only from its own time.",
      "Verdict order: Not applicable, Too early, Not enough data, then Scale / Change / Stop.",
      "A dated check is judged on the data as of its check date; weekly and open-ended checks use the selected date.",
    ],
    caveats: [
      "All thresholds are ASSUMPTIONS. No comparison here proves cause.",
      "Cost per modelled attendee uses the planned increment: incrementality is not observed.",
      ...(data.bets ? [] : ["The original 2025 data predates the bets: only attendees, the projection and channel efficiency can be answered, plus two proxies."]),
    ],
  };
}
