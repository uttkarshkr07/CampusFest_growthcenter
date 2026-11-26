// A safe, allowlisted slice-and-count tool for questions the fixed reports do not cover.
// The model picks fields, filters and measures by name; it never writes code or SQL.
import { baseCaveats, DEF, externalStatusCounts, snapshot, type Snapshot } from "./metrics";
import type { Dataset, Result } from "./types";
import { addDays, DAY_MS, istDay } from "./time";

export const QUERY_DATASETS = ["people", "scans", "daily_marketing"] as const;
export type QueryDataset = (typeof QUERY_DATASETS)[number];
export const QUERY_OPS = ["eq", "neq", "in", "gte", "lte", "contains"] as const;

export interface QueryFilter {
  field: string;
  op: (typeof QUERY_OPS)[number];
  values: string[];
}
export interface QuerySpec {
  asOf: string;
  dataset: QueryDataset;
  filters?: QueryFilter[];
  groupBy?: string[];
  measures?: string[];
  limit?: number;
}

type Cell = string | number | boolean | null | string[];
type Row = Record<string, Cell>;

interface DatasetDef {
  fields: Record<string, string>;
  /** fields and measures that only exist once the event has started */
  outcome: string[];
  measures: Record<string, { help: string; run: (rows: Row[]) => number | null }>;
  build: (s: Snapshot) => Row[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
const distinct = (rows: Row[], k: string) => new Set(rows.map((r) => r[k])).size;
const countWhere = (rows: Row[], k: string) => rows.filter((r) => r[k] === true).length;
const pctOf = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);

const istHour = (ms: number) => new Date(ms + 5.5 * 3600 * 1000).getUTCHours();
/** Monday of the IST week that contains this day. */
function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

function buildPeople(s: Snapshot): Row[] {
  const p = s.p;
  const { confirmed } = externalStatusCounts(s);
  const attendedDays = new Map<string, Set<string>>();
  for (const c of p.checkins) {
    if (c.ms > s.asOfMs || c.result !== "admitted" || c.verification !== "verified") continue;
    let set = attendedDays.get(c.person_id);
    if (!set) attendedDays.set(c.person_id, (set = new Set()));
    set.add(istDay(c.ms));
  }
  return p.people
    .filter((x) => x.ms <= s.asOfMs)
    .map((x) => {
      const regs = (p.regsByPerson.get(x.person_id) ?? []).filter((r) => r.ms <= s.asOfMs).sort((a, b) => a.ms - b.ms);
      const reg = regs[0];
      const ext = x.person_type === "external";
      const days = ext ? [...(attendedDays.get(x.person_id) ?? [])].sort() : [];
      const types = [...new Set((p.interactionsByPerson.get(x.person_id) ?? []).filter((i) => i.ms <= s.asOfMs).map((i) => i.event_type))];
      return {
        person_id: x.person_id,
        person_type: x.person_type,
        first_touch_source: x.first_touch_source,
        first_campaign_id: x.first_campaign_id,
        campaign_id: reg?.campaign_id ?? null,
        registered: !!reg,
        registered_day: reg ? istDay(reg.ms) : null,
        weeks_before_event: reg ? Math.floor((p.event.startMs - reg.ms) / (7 * DAY_MS)) : null,
        status: reg ? (s.statusOf(reg.registration_id, s.statusMs)?.status ?? null) : null,
        confirmed: confirmed.has(x.person_id),
        engaged: s.questionAskers.has(x.person_id),
        interaction_types: types,
        attended: days.length > 0,
        walk_in: days.length > 0 && !reg,
        days_attended: days.length,
        attended_days: days,
        first_attended_day: days[0] ?? null,
      };
    });
}

function buildScans(s: Snapshot): Row[] {
  const p = s.p;
  return p.checkins
    .filter((c) => c.ms <= s.asOfMs)
    .map((c) => {
      const type = p.personById.get(c.person_id)?.person_type ?? "unknown";
      return {
        person_id: c.person_id,
        person_type: type,
        day: istDay(c.ms),
        hour: istHour(c.ms),
        result: c.result,
        verification: c.verification,
        source: c.source,
        campaign_id: s.campaignOfPerson(c.person_id),
        counts_as_attendance: c.result === "admitted" && c.verification === "verified" && type === "external",
      };
    });
}

function buildDaily(s: Snapshot): Row[] {
  return s.p.daily
    .filter((d) => d.ms <= s.asOfMs)
    .map((d) => ({
      campaign_id: d.campaign_id,
      day: d.activity_date,
      week: weekStart(d.activity_date),
      platform: d.platform,
      spend: Number(d.marketing_spend_inr ?? 0),
      impressions: Number(d.impressions ?? 0),
      clicks: Number(d.clicks ?? 0),
      sessions: Number(d.landing_page_sessions ?? 0),
      registration_starts: Number(d.registration_starts ?? 0),
    }));
}

export const QUERY_DEFS: Record<QueryDataset, DatasetDef> = {
  people: {
    fields: {
      person_id: "stable id",
      person_type: "external | internal | staff | test",
      first_touch_source: "first source seen",
      first_campaign_id: "first-touch campaign",
      campaign_id: "acquisition campaign from the registration",
      registered: "true/false",
      registered_day: "YYYY-MM-DD",
      weeks_before_event: "whole weeks between registration and event start",
      status: "interested | confirmed | cancelled | waitlisted (at as-of, or at event start once it began)",
      confirmed: "true/false",
      engaged: "submitted an event question",
      interaction_types: "list; use op 'contains'",
      attended: "true/false",
      walk_in: "attended without a registration",
      days_attended: "number of event days attended",
      attended_days: "list of YYYY-MM-DD; use op 'contains'",
      first_attended_day: "YYYY-MM-DD",
    },
    outcome: ["attended", "walk_in", "days_attended", "attended_days", "first_attended_day", "show_up_pct", "walk_ins"],
    measures: {
      people: { help: "distinct people", run: (r) => r.length },
      registered: { help: "registered people", run: (r) => countWhere(r, "registered") },
      confirmed: { help: "confirmed people", run: (r) => countWhere(r, "confirmed") },
      engaged: { help: "people who submitted a question", run: (r) => countWhere(r, "engaged") },
      attended: { help: "actual attendees (external only by definition)", run: (r) => countWhere(r, "attended") },
      walk_ins: { help: "attendees without a registration", run: (r) => countWhere(r, "walk_in") },
      show_up_pct: { help: "registered people who attended / registered people", run: (r) => pctOf(r.filter((x) => x.registered && x.attended).length, countWhere(r, "registered")) },
    },
    build: buildPeople,
  },
  scans: {
    fields: {
      person_id: "stable id",
      person_type: "external | internal | staff | test",
      day: "YYYY-MM-DD (IST)",
      hour: "0-23 (IST)",
      result: "admitted | denied | pending",
      verification: "verified | unverified",
      source: "scanner | manual",
      campaign_id: "acquisition campaign of the person",
      counts_as_attendance: "admitted AND verified AND external",
    },
    outcome: [],
    measures: {
      scans: { help: "scan records (one person can have several)", run: (r) => r.length },
      distinct_people: { help: "distinct people among those scans", run: (r) => distinct(r, "person_id") },
    },
    build: buildScans,
  },
  daily_marketing: {
    fields: { campaign_id: "campaign", day: "YYYY-MM-DD", week: "Monday of the week", platform: "platform" },
    outcome: [],
    measures: {
      spend: { help: "net spend in INR", run: (r) => sum(r, "spend") },
      impressions: { help: "anonymous count", run: (r) => sum(r, "impressions") },
      clicks: { help: "anonymous count", run: (r) => sum(r, "clicks") },
      sessions: { help: "anonymous count", run: (r) => sum(r, "sessions") },
      registration_starts: { help: "anonymous count", run: (r) => sum(r, "registration_starts") },
      ctr_pct: { help: "clicks / impressions", run: (r) => pctOf(sum(r, "clicks"), sum(r, "impressions")) },
    },
    build: buildDaily,
  },
};

function matches(row: Row, f: QueryFilter): boolean {
  const v = row[f.field];
  const norm = (x: unknown) => String(x ?? "").toLowerCase();
  const wanted = f.values.map(norm);
  if (f.op === "contains") return Array.isArray(v) ? v.some((x) => wanted.includes(norm(x))) : norm(v).includes(wanted[0]);
  if (Array.isArray(v)) {
    const hit = v.some((x) => wanted.includes(norm(x)));
    return f.op === "neq" ? !hit : hit;
  }
  if (f.op === "eq") return norm(v) === wanted[0];
  if (f.op === "neq") return !wanted.includes(norm(v));
  if (f.op === "in") return wanted.includes(norm(v));
  if (v == null) return false;
  const numeric = typeof v === "number" && !Number.isNaN(Number(f.values[0]));
  const cmp = numeric ? (v as number) - Number(f.values[0]) : norm(v).localeCompare(wanted[0]);
  return f.op === "gte" ? cmp >= 0 : cmp <= 0;
}

export interface QueryValue {
  asOf: string;
  dataset: QueryDataset;
  matchedRows: number;
  totals: Record<string, number | null>;
  groups: Record<string, string | number | null>[];
  groupsShown: number;
  groupsTotal: number;
  /** the group with the highest first measure among ALL groups, whatever the order or limit */
  largestGroup: Record<string, string | number | null> | null;
}

export function query(data: Dataset, spec: QuerySpec): Result<QueryValue | null> {
  const s = snapshot(data, spec.asOf);
  const def = QUERY_DEFS[spec.dataset];
  const filters = spec.filters ?? [];
  const groupBy = spec.groupBy ?? [];
  const measures = spec.measures?.length ? spec.measures : [Object.keys(def.measures)[0]];

  const cannot = (why: string): Result<null> => ({ value: null, basis: [DEF.asOf], caveats: [why] });
  const badField = [...filters.map((f) => f.field), ...groupBy].find((f) => !(f in def.fields));
  if (badField) return cannot(`'${badField}' is not a field of ${spec.dataset}. Fields: ${Object.keys(def.fields).join(", ")}. If none fits, the data cannot answer this.`);
  const badMeasure = measures.find((m) => !(m in def.measures));
  if (badMeasure) return cannot(`'${badMeasure}' is not a measure of ${spec.dataset}. Measures: ${Object.keys(def.measures).join(", ")}.`);
  if (groupBy.length > 2) return cannot("At most 2 group-by fields.");
  if (filters.some((f) => !f.values.length)) return cannot("Every filter needs at least one value.");
  if (s.phase === "pre-event") {
    const used = [...filters.map((f) => f.field), ...groupBy, ...measures].filter((f) => def.outcome.includes(f));
    if (used.length) return cannot(`The event has not happened at this date, so ${used.join(", ")} cannot be known yet.`);
  }

  // People measures describe external people unless the caller filters or groups by person_type.
  const scoped = spec.dataset === "people" && !filters.some((f) => f.field === "person_type") && !groupBy.includes("person_type");
  const all = def.build(s);
  const rows = all.filter((r) => (!scoped || r.person_type === "external") && filters.every((f) => matches(r, f)));
  const compute = (set: Row[]) => Object.fromEntries(measures.map((m) => [m, def.measures[m].run(set)]));

  const buckets = new Map<string, { key: Cell[]; rows: Row[] }>();
  if (groupBy.length) {
    for (const r of rows) {
      // list fields (interaction_types, attended_days) put a row in one group per element
      let keys: Cell[][] = [[]];
      for (const g of groupBy) {
        const v = r[g];
        const options: Cell[] = Array.isArray(v) ? (v.length ? v : [null]) : [v];
        keys = keys.flatMap((k) => options.map((o) => [...k, o]));
      }
      for (const key of keys) {
        const id = JSON.stringify(key);
        let b = buckets.get(id);
        if (!b) buckets.set(id, (b = { key, rows: [] }));
        b.rows.push(r);
      }
    }
  }
  const chronological = ["day", "hour", "week", "registered_day", "first_attended_day", "attended_days", "weeks_before_event"].includes(groupBy[0]);
  const groups = [...buckets.values()].map((b) => ({
    ...Object.fromEntries(groupBy.map((g, i) => [g, b.key[i] as string | number | null])),
    ...compute(b.rows),
  })) as Record<string, string | number | null>[];
  groups.sort((a, b) => {
    if (chronological) {
      const x = a[groupBy[0]], y = b[groupBy[0]];
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x).localeCompare(String(y));
    }
    return Number(b[measures[0]] ?? 0) - Number(a[measures[0]] ?? 0);
  });
  const limit = Math.max(1, Math.min(60, spec.limit ?? 30));
  const largestGroup = groups.reduce<(typeof groups)[number] | null>((best, g) => (!best || Number(g[measures[0]] ?? 0) > Number(best[measures[0]] ?? 0) ? g : best), null);

  const caveats = baseCaveats(s);
  if (groups.length > limit) caveats.push(`Only ${limit} of ${groups.length} groups are shown; totals cover every matching row.`);
  if (groupBy.some((g) => g === "interaction_types" || g === "attended_days")) caveats.push("A person can appear in several of these groups, so the groups do not add up to the total.");
  if (spec.dataset === "scans" && !filters.some((f) => f.field === "counts_as_attendance" || f.field === "person_type") && !groupBy.includes("counts_as_attendance") && !groupBy.includes("person_type"))
    caveats.unshift("WARNING: these scans include people who do not count as visitors (internal, staff, test). For attendance figures, run the query again with counts_as_attendance eq true.");
  if (spec.dataset === "daily_marketing") caveats.push("These are anonymous event counts, not people. Reach is not offered because summing it does not give unique people.");

  const basis = [DEF.asOf, DEF.dedup, `Query on ${spec.dataset}; filters: ${filters.length ? filters.map((f) => `${f.field} ${f.op} ${f.values.join("|")}`).join("; ") : "none"}${groupBy.length ? `; grouped by ${groupBy.join(", ")}` : ""}.`];
  if (scoped) basis.push("Scope: external people only (no person_type filter was given).");
  if (spec.dataset === "people") basis.push(DEF.attendee, DEF.attribution);
  if (spec.dataset === "daily_marketing") basis.push(DEF.spend);

  return {
    value: { asOf: s.label, dataset: spec.dataset, matchedRows: rows.length, totals: compute(rows), groups: groups.slice(0, limit), groupsShown: Math.min(limit, groups.length), groupsTotal: groups.length, largestGroup },
    basis,
    caveats,
  };
}
