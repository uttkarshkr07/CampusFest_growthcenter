// The Overview's engine: a daily series of registered and confirmed people, the landing forecast built on it,
// how that forecast did at earlier dates, the gate view on fest days, the leak funnel and the briefing.
// Everything is computed from rows at or before the as-of date.
import { baseCaveats, DEF, externalStatusCounts, flags, funnel, snapshot, spendAsOf, type Phase } from "./metrics";
import { countsAsAdmission, prepare, type Prepared } from "./prepare";
import { addDays, daysBetween, istDay } from "./time";
import type { Dataset, Result } from "./types";

const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const r1 = (x: number) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------------------
// Daily series
// ---------------------------------------------------------------------------
interface SeriesCache {
  days: string[];
  index: Map<string, number>;
  registered: number[];
  confirmed: number[];
}

const seriesCache = new WeakMap<Prepared, SeriesCache>();

/**
 * Registered and confirmed external people at the end of each IST day. One pass over the registrations and their
 * history: the value on a day uses only rows at or before the end of that day, so slicing at the as-of day cannot
 * leak later data. Counting rules match externalStatusCounts (one registration per person, the earliest).
 */
function buildSeries(p: Prepared): SeriesCache {
  const hit = seriesCache.get(p);
  if (hit) return hit;
  const first = p.event.historyStart;
  const last = [p.event.historyEnd, p.event.endDay].filter(Boolean).sort().pop() ?? p.event.endDay;
  const days: string[] = [];
  for (let d = first, k = 0; d <= last && k < 800; d = addDays(d, 1), k++) days.push(d);
  const index = new Map(days.map((d, i) => [d, i]));
  const N = days.length;
  const at = (ms: number) => {
    const d = istDay(ms);
    if (d < first) return 0;
    return index.get(d) ?? N;
  };
  const earliest = new Map<string, (typeof p.registrations)[number]>();
  for (const r of p.registrations) {
    if (p.personById.get(r.person_id)?.person_type !== "external") continue;
    const prev = earliest.get(r.person_id);
    if (!prev || r.ms < prev.ms) earliest.set(r.person_id, r);
  }
  const reg = new Array(N + 1).fill(0);
  const conf = new Array(N + 1).fill(0);
  for (const r of earliest.values()) {
    const ri = at(r.ms);
    if (ri < N) reg[ri]++;
    const hs = p.historyByReg.get(r.registration_id) ?? [];
    for (let i = 0; i < hs.length; i++) {
      if (hs[i].status !== "confirmed") continue;
      const start = Math.max(at(hs[i].ms), ri);
      const end = i + 1 < hs.length ? at(hs[i + 1].ms) : N; // exclusive: the next version wins from its day on
      if (start < end && start < N) {
        conf[start]++;
        conf[Math.min(end, N)]--;
      }
    }
  }
  const registered: number[] = [];
  const confirmed: number[] = [];
  let a = 0,
    b = 0;
  for (let i = 0; i < N; i++) {
    a += reg[i];
    b += conf[i];
    registered.push(a);
    confirmed.push(b);
  }
  const out = { days, index, registered, confirmed };
  seriesCache.set(p, out);
  return out;
}

export interface SeriesPoint {
  day: string;
  registered: number;
  confirmed: number;
}

export function dailySeries(data: Dataset, asOf: string): Result<{ asOf: string; points: SeriesPoint[] }> {
  const s = snapshot(data, asOf);
  const c = buildSeries(s.p);
  const points: SeriesPoint[] = [];
  for (let i = 0; i < c.days.length && c.days[i] <= s.day; i++) points.push({ day: c.days[i], registered: c.registered[i], confirmed: c.confirmed[i] });
  return {
    value: { asOf: s.label, points },
    basis: [DEF.asOf, DEF.registered, DEF.status, "Each point is the count at the end of that IST day."],
    caveats: baseCaveats(s),
  };
}

// ---------------------------------------------------------------------------
// Landing forecast
// ---------------------------------------------------------------------------
function targetAt(p: Prepared, ms: number) {
  let t = null as (typeof p.targets)[number] | null;
  for (const x of p.targets) if (x.ms <= ms) t = x;
  return t;
}

export interface ForecastNumbers {
  day: string;
  confirmed: number;
  /** net new confirmed people per day over the last 7, 14 and 28 days (never below 0) */
  pace: { d7: number; d14: number; d28: number };
  /** full days left for sign-ups before the fest's first day */
  daysLeft: number;
  low: number;
  mid: number;
  high: number;
  /** today's confirmed people only, mid show-up: the floor if nobody else confirms */
  banked: number;
}

/** The forecast as it would have been made at the end of `day`, from the series alone. */
function forecastAt(p: Prepared, c: SeriesCache, day: string, confirmedOverride?: number): ForecastNumbers {
  const st = p.settings;
  const i = Math.min(c.index.get(day) ?? (day < c.days[0] ? 0 : c.days.length - 1), c.days.length - 1);
  const confirmed = confirmedOverride ?? c.confirmed[i] ?? 0;
  const pace = (k: number) => {
    const j = Math.max(0, i - k);
    const span = i - j;
    return span > 0 ? Math.max(0, (c.confirmed[i] - c.confirmed[j]) / span) : 0;
  };
  const d7 = pace(7),
    d14 = pace(14),
    d28 = pace(28);
  const daysLeft = Math.max(0, daysBetween(day, p.event.startDay) - 1);
  const w = st.walkin_assumption;
  const land = (perDay: number, show: number) => Math.round((confirmed + perDay * daysLeft) * show + w);
  return {
    day,
    confirmed,
    pace: { d7: r1(d7), d14: r1(d14), d28: r1(d28) },
    daysLeft,
    low: land(Math.min(d7, d28), st.showup_low),
    mid: land(d14, st.showup_mid),
    high: land(Math.max(d7, d14, d28), st.showup_high),
    banked: Math.round(confirmed * st.showup_mid + w),
  };
}

export interface ConePoint {
  day: string;
  registered: number | null;
  confirmed: number | null;
  /** forecast band of confirmed people, future days only */
  coneLow: number | null;
  coneMid: number | null;
  coneHigh: number | null;
  /** confirmed people needed for the visitor goal at mid show-up */
  needed: number | null;
}

export interface LandingForecast {
  asOf: string;
  phase: Phase;
  daysToEvent: number;
  goal: number | null;
  targetVersion: string | null;
  assumptions: { showupLow: number; showupMid: number; showupHigh: number; walkIns: number };
  forecast: ForecastNumbers;
  /** mid forecast minus the goal; negative = short */
  gap: number | null;
  /** confirmed people needed for the goal at mid show-up, and how many more per day that means */
  neededConfirmed: number | null;
  neededPerDay: number | null;
  chart: ConePoint[];
  /** days where a new target version took effect, for chart markers */
  targetChanges: { day: string; version: string }[];
}

export function landingForecast(data: Dataset, asOf: string): Result<LandingForecast> {
  const s = snapshot(data, asOf);
  const p = s.p;
  const c = buildSeries(p);
  const st = p.settings;
  const t = targetAt(p, s.asOfMs);
  const goal = t?.unique_external_visitors_goal ?? null;
  // before the event, today's figure comes from the same count the funnel uses
  const confirmedNow = s.phase === "pre-event" ? externalStatusCounts(s).counts.confirmed : undefined;
  const fc = forecastAt(p, c, s.day < p.event.startDay ? s.day : addDays(p.event.startDay, -1), confirmedNow);
  const needed = (g: number | null) => (g != null ? Math.max(0, Math.ceil((g - st.walkin_assumption) / Math.max(0.01, st.showup_mid))) : null);
  const neededConfirmed = needed(goal);
  const neededPerDay = neededConfirmed != null && fc.daysLeft > 0 ? r1(Math.max(0, neededConfirmed - fc.confirmed) / fc.daysLeft) : null;

  const chart: ConePoint[] = [];
  const lastDay = addDays(p.event.startDay, -1);
  for (let i = 0; i < c.days.length && c.days[i] <= lastDay; i++) {
    const day = c.days[i];
    const past = day <= s.day;
    const ahead = past ? 0 : daysBetween(s.day, day);
    const g = targetAt(p, Math.min(s.asOfMs, Date.parse(`${day}T23:59:59.999+05:30`)))?.unique_external_visitors_goal ?? null;
    chart.push({
      day,
      registered: past ? c.registered[i] : null,
      confirmed: past ? c.confirmed[i] : null,
      coneLow: past ? (day === s.day ? fc.confirmed : null) : Math.round(fc.confirmed + Math.min(fc.pace.d7, fc.pace.d28) * ahead),
      coneMid: past ? (day === s.day ? fc.confirmed : null) : Math.round(fc.confirmed + fc.pace.d14 * ahead),
      coneHigh: past ? (day === s.day ? fc.confirmed : null) : Math.round(fc.confirmed + Math.max(fc.pace.d7, fc.pace.d14, fc.pace.d28) * ahead),
      needed: needed(g),
    });
  }
  const targetChanges = p.targets.filter((x) => x.ms <= s.asOfMs).map((x) => ({ day: istDay(x.ms), version: x.target_version }));

  const caveats = baseCaveats(s);
  caveats.push(
    "ASSUMPTION: show-up rates and walk-ins come from Settings, not from observed data.",
    "ASSUMPTION: sign-ups keep their recent pace in a straight line. Real sign-ups are usually back-loaded, so early dates tend to read low.",
  );
  if (s.phase !== "pre-event") caveats.push("The event has started: this shows the forecast as it stood the day before the fest. See the actual figures.");
  return {
    value: {
      asOf: s.label,
      phase: s.phase,
      daysToEvent: Math.max(0, daysBetween(s.day, p.event.startDay)),
      goal,
      targetVersion: t?.target_version ?? null,
      assumptions: { showupLow: st.showup_low, showupMid: st.showup_mid, showupHigh: st.showup_high, walkIns: st.walkin_assumption },
      forecast: fc,
      gap: goal != null ? fc.mid - goal : null,
      neededConfirmed,
      neededPerDay,
      chart,
      targetChanges,
    },
    basis: [
      DEF.asOf,
      DEF.status,
      "Pace = net new confirmed people per day over the last 7, 14 or 28 days (cancellations subtract; never below 0).",
      "Mid = (confirmed now + 14-day pace x days left) x mid show-up + walk-ins.",
      "Low = (confirmed now + the lower of the 7- and 28-day pace x days left) x low show-up + walk-ins.",
      "High = (confirmed now + the highest pace x days left) x high show-up + walk-ins.",
      "Days left = full days before the fest's first day. Needed confirmed = (visitor goal - walk-ins) / mid show-up.",
    ],
    caveats,
  };
}

/** What the forecast said at fixed points before the fest, against what happened. */
export function forecastHistory(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const c = buildSeries(p);
  const checkpoints = [28, 14, 7, 1]
    .map((k) => ({ k, day: addDays(p.event.startDay, -k) }))
    .filter((x) => x.day >= p.event.historyStart && x.day <= s.day)
    .map((x) => ({ label: `T-${x.k}`, ...forecastAt(p, c, x.day) }));
  const actual = s.phase === "post-event" ? s.attendees.size : null;
  return {
    value: {
      asOf: s.label,
      actual,
      checkpoints: checkpoints.map((x) => ({
        label: x.label,
        day: x.day,
        low: x.low,
        mid: x.mid,
        high: x.high,
        errorPct: actual != null ? r1(((x.mid - actual) / Math.max(1, actual)) * 100) : null,
        inRange: actual != null ? actual >= x.low && actual <= x.high : null,
      })),
    },
    basis: [DEF.asOf, DEF.attendee, "Each checkpoint reruns the landing forecast with only the data known at the end of that day."],
    caveats: ["Show-up and walk-in assumptions are today's Settings values, applied to every checkpoint."],
  } satisfies Result<unknown>;
}

// ---------------------------------------------------------------------------
// Fest days: the gate
// ---------------------------------------------------------------------------
export function liveGate(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const day1 = p.event.startDay;
  const day2 = addDays(day1, 1);
  const byDay = new Map<string, Set<string>>();
  const hourly = new Map<string, number[]>();
  let denied = 0;
  const failed = new Set<string>();
  for (const ck of p.checkins) {
    if (ck.ms > s.asOfMs || !s.isExternal(ck.person_id)) continue;
    if (!countsAsAdmission(ck)) {
      if (ck.inEvent) {
        failed.add(ck.person_id);
        if (ck.result === "denied") denied++;
      }
      continue;
    }
    const d = istDay(ck.ms);
    if (!byDay.has(d)) byDay.set(d, new Set());
    byDay.get(d)!.add(ck.person_id);
    const h = new Date(ck.ms + 5.5 * 3600000).getUTCHours();
    if (!hourly.has(d)) hourly.set(d, new Array(24).fill(0));
    hourly.get(d)![h]++;
  }
  const d1 = byDay.get(day1) ?? new Set<string>();
  const d2 = byDay.get(day2) ?? new Set<string>();
  const both = [...d2].filter((x) => d1.has(x)).length;
  const showDay = s.day >= day2 ? day2 : day1;
  const hours = (hourly.get(showDay) ?? new Array(24).fill(0)).map((count, hour) => ({ hour: `${String(hour).padStart(2, "0")}:00`, count })).filter((x, i, all) => x.count > 0 || (i > 0 && all.slice(0, i).some((y) => y.count > 0) && all.slice(i).some((y) => y.count > 0)));
  return {
    value: {
      asOf: s.label,
      phase: s.phase,
      attendees: s.attendees.size,
      walkIns: s.walkIns.size,
      day1: { day: day1, people: d1.size },
      day2: { day: day2, people: d2.size, firstTimers: d2.size - both },
      bothDays: both,
      hourlyDay: showDay,
      hourly: hours,
      unresolvedGate: [...failed].filter((x) => !s.attendees.has(x)).length,
      deniedScans: denied,
    },
    basis: [DEF.asOf, DEF.attendee, "Per day = distinct people admitted that IST day. Hourly = admission scans that count, not people.", "Unresolved = external people with a denied, pending or unverified scan during the event and no admission that counts."],
    caveats: baseCaveats(s),
  } satisfies Result<unknown>;
}

// ---------------------------------------------------------------------------
// Leak funnel
// ---------------------------------------------------------------------------
export interface LeakStep {
  from: string;
  to: string;
  fromCount: number;
  toCount: number;
  conversionPct: number | null;
  /** conversion the target version implies, when it has goals for both stages */
  plannedPct: number | null;
  lost: number;
  /** cohort on the Actions page holding the people lost here */
  cohort: string | null;
}

export function leakFunnel(data: Dataset, asOf: string) {
  const f = funnel(data, asOf);
  const s = snapshot(data, asOf);
  const t = targetAt(s.p, s.asOfMs);
  const st = (k: string) => f.value.stages.find((x) => x.key === k);
  const ids = ["identified", "registered", "confirmed", ...(f.value.phase === "pre-event" ? [] : ["attended"])];
  const stages = ids.map((k) => st(k)!).filter(Boolean);
  const plan: Record<string, number | null> = {
    "identified>registered": t && t.identified_external_people_goal ? (t.registration_goal / t.identified_external_people_goal) * 100 : null,
    "confirmed>attended": null,
    "registered>confirmed": null,
  };
  const cohortFor: Record<string, string | null> = {
    "identified>registered": null,
    "registered>confirmed": "interested_not_confirmed",
    "confirmed>attended": f.value.phase === "pre-event" ? "confirmed_not_engaged" : "gate_failed_not_admitted",
  };
  const steps: LeakStep[] = [];
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1],
      b = stages[i];
    const key = `${a.key}>${b.key}`;
    steps.push({
      from: a.label,
      to: b.label,
      fromCount: a.count,
      toCount: b.count,
      conversionPct: a.count ? r1((b.count / a.count) * 100) : null,
      plannedPct: plan[key] != null ? r1(plan[key]!) : null,
      lost: Math.max(0, a.count - b.count),
      cohort: cohortFor[key] ?? null,
    });
  }
  const worst = steps.reduce<LeakStep | null>((w, x) => (!w || x.lost > w.lost ? x : w), null);
  return {
    value: {
      asOf: f.value.asOf,
      phase: f.value.phase,
      stages: stages.map((x) => ({ key: x.key, label: x.label, count: x.count, definition: x.definition })),
      steps,
      worst: worst ? `${worst.from} > ${worst.to}` : null,
      walkIns: f.value.walkIns,
      actualAttendees: f.value.actualAttendees,
      statusAtSnapshot: f.value.statusAtSnapshot,
      confirmedNoShows: f.value.confirmedNoShows,
      targetVersion: t?.target_version ?? null,
      visitorGoal: t?.unique_external_visitors_goal ?? null,
    },
    basis: [...f.basis, "Planned conversion = registration goal / identified goal of the target version in force."],
    caveats: f.caveats,
  } satisfies Result<unknown>;
}

// ---------------------------------------------------------------------------
// Budget burn
// ---------------------------------------------------------------------------
export function budgetBurn(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const t = targetAt(p, s.asOfMs);
  const spent = spendAsOf(s);
  const from = addDays(s.day, -14);
  let last14 = 0;
  for (const d of p.daily) if (d.activity_date > from && d.activity_date <= s.day) last14 += Number(d.marketing_spend_inr ?? 0);
  const perDay = last14 / 14;
  const daysLeft = s.phase === "pre-event" ? Math.max(0, daysBetween(s.day, p.event.startDay) - 1) : 0;
  const projected = Math.round(spent + Math.max(0, perDay) * daysLeft);
  const budget = t?.marketing_budget_inr ?? null;
  return {
    value: { asOf: s.label, spent, budget, perDay: Math.round(perDay), daysLeft, projected, projectedOver: budget != null ? projected - budget : null, usedPct: budget ? r1((spent / budget) * 100) : null },
    basis: [DEF.asOf, DEF.spend, "Projected = spent + the last 14 days' average daily spend x full days left before the fest."],
    caveats: ["ASSUMPTION: daily spend stays at its last-14-day average. Planned bursts are not in the data."],
  } satisfies Result<unknown>;
}

// ---------------------------------------------------------------------------
// Briefing: a few plain sentences, built from the numbers by a template
// ---------------------------------------------------------------------------
export function briefing(data: Dataset, asOf: string) {
  const s = snapshot(data, asOf);
  const p = s.p;
  const lf = landingForecast(data, asOf).value;
  const fmtDay = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const lines: string[] = [];
  if (s.phase === "pre-event") {
    lines.push(`${fmtDay(s.day)}: ${lf.daysToEvent} day${lf.daysToEvent === 1 ? "" : "s"} to the fest. ${n(lf.forecast.confirmed)} people confirmed so far.`);
    if (lf.goal != null)
      lines.push(
        `At the last 14 days' pace we land about ${n(lf.forecast.mid)} attendees (${n(lf.forecast.low)} to ${n(lf.forecast.high)}) against the ${n(lf.goal)} goal${lf.gap != null ? `, ${lf.gap >= 0 ? `${n(lf.gap)} above` : `${n(-lf.gap)} short`}` : ""}.`,
      );
  } else {
    const g = lf.goal;
    lines.push(
      `${fmtDay(s.day)}: ${s.phase === "live" ? "the fest is on" : "the fest is over"}. ${n(s.attendees.size)} people actually attended${g ? `, ${r1((s.attendees.size / g) * 100)}% of the ${n(g)} goal` : ""}.`,
    );
  }
  const fl = flags(data, asOf).value.flags.filter((f) => f.level === "stop");
  if (fl.length) {
    const w = fl[0];
    const unit = s.phase === "post-event" ? "cost per actual attendee" : "cost per confirmed";
    lines.push(`Biggest drag: ${w.campaign_name} at ${w.metrics.costRatio ?? "n/a"}x the blended ${unit}.`);
  } else {
    const lk = leakFunnel(data, asOf).value;
    const worst = lk.steps.reduce<LeakStep | null>((a, b) => (!a || b.lost > a.lost ? b : a), null);
    if (worst && worst.lost > 0) lines.push(`Biggest leak: ${worst.from} to ${worst.to}, ${n(worst.lost)} people.`);
  }
  return { value: { asOf: s.label, phase: s.phase, lines, event: p.event.name }, basis: [DEF.asOf], caveats: [] as string[] } satisfies Result<unknown>;
}
