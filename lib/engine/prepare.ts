import type {
  CampaignRow,
  CheckinRow,
  DailyRow,
  Dataset,
  HistoryRow,
  InteractionRow,
  PersonRow,
  RegistrationRow,
  TargetRow,
} from "./types";
import { resolveSettings, type EngineSettings } from "./settings";
import { endOfIstDay, istDay, toMs } from "./time";

export type WithMs<T> = T & { ms: number };

export interface DedupStat {
  table: string;
  idField: string;
  raw: number;
  unique: number;
  identicalCopies: number;
  conflictingIds: string[];
}

export interface Prepared {
  data: Dataset;
  settings: EngineSettings;
  event: {
    name: string;
    historyStart: string;
    historyEnd: string;
    startMs: number;
    endMs: number;
    startDay: string;
    endDay: string;
  };
  targets: WithMs<TargetRow>[];
  campaigns: WithMs<CampaignRow>[];
  campaignById: Map<string, WithMs<CampaignRow>>;
  daily: (DailyRow & { ms: number })[]; // ms = END of activity_date (when the aggregate is available)
  people: WithMs<PersonRow>[];
  personById: Map<string, WithMs<PersonRow>>;
  interactions: WithMs<InteractionRow>[];
  interactionsByPerson: Map<string, WithMs<InteractionRow>[]>;
  registrations: WithMs<RegistrationRow>[];
  regsByPerson: Map<string, WithMs<RegistrationRow>[]>;
  regById: Map<string, WithMs<RegistrationRow>>;
  history: WithMs<HistoryRow>[];
  historyByReg: Map<string, WithMs<HistoryRow>[]>;
  checkins: WithMs<CheckinRow>[];
  dedup: DedupStat[];
  warnings: string[];
}

function canonical(row: object): string {
  const r = row as Record<string, unknown>;
  const keys = Object.keys(r)
    .filter((k) => !k.startsWith("_"))
    .sort();
  return keys.map((k) => `${k}=${JSON.stringify(r[k] ?? null)}`).join("|");
}

/** Dedupe by a stable ID. Identical copies count once; conflicting payloads keep the LAST row and are reported. */
export function dedupe<T extends object>(rows: T[], idField: keyof T & string, table: string): { rows: T[]; stat: DedupStat } {
  const live = rows.filter((r) => !(r as { _deleted?: boolean })._deleted);
  const byId = new Map<string, { row: T; sig: string; idx: number }>();
  let identical = 0;
  const conflicting = new Set<string>();
  live.forEach((row, idx) => {
    const id = String(row[idField] ?? "");
    const sig = canonical(row);
    const prev = byId.get(id);
    if (prev) {
      if (prev.sig === sig) identical++;
      else conflicting.add(id);
      byId.set(id, { row, sig, idx: prev.idx }); // keep last payload, original position
    } else byId.set(id, { row, sig, idx });
  });
  const out = [...byId.values()].sort((a, b) => a.idx - b.idx).map((v) => v.row);
  return {
    rows: out,
    stat: {
      table,
      idField,
      raw: live.length,
      unique: out.length,
      identicalCopies: identical,
      conflictingIds: [...conflicting],
    },
  };
}

function group<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function sortByRowId<T>(rows: T[]): T[] {
  // Rows from Supabase carry _row_id; keep insertion order so "last" means latest import/edit.
  const hasIds = rows.length > 0 && (rows[0] as { _row_id?: number })._row_id != null;
  if (!hasIds) return rows;
  return [...rows].sort((a, b) => ((a as { _row_id?: number })._row_id ?? 0) - ((b as { _row_id?: number })._row_id ?? 0));
}

const cache = new WeakMap<Dataset, Prepared>();

export function prepare(data: Dataset): Prepared {
  const hit = cache.get(data);
  if (hit) return hit;
  const warnings: string[] = [];
  const dedup: DedupStat[] = [];
  const run = <T extends object>(rows: T[], id: keyof T & string, table: string) => {
    const { rows: out, stat } = dedupe(sortByRowId(rows ?? []), id, table);
    dedup.push(stat);
    if (stat.conflictingIds.length)
      warnings.push(
        `${table}: ${stat.conflictingIds.length} ID(s) appear with DIFFERENT payloads (kept the last version): ${stat.conflictingIds.slice(0, 5).join(", ")}${stat.conflictingIds.length > 5 ? ", ..." : ""}`,
      );
    return out;
  };

  const ev = (data.event ?? []).filter((e) => !e._deleted)[0];
  if (!ev) warnings.push("event: no event row; using CampusFest 2025 defaults (12 to 13 Apr 2025).");
  const startMs = toMs(ev?.event_starts_at ?? "2025-04-12T10:00:00+05:30");
  const endMs = toMs(ev?.event_ends_at ?? "2025-04-13T20:00:00+05:30");
  const event = {
    name: ev?.event_name ?? "CampusFest 2025",
    historyStart: (ev?.history_start ?? "2025-01-15").slice(0, 10),
    historyEnd: (ev?.history_end ?? "2025-04-20").slice(0, 10),
    startMs,
    endMs,
    startDay: istDay(startMs),
    endDay: istDay(endMs),
  };

  const withMs = <T extends object>(rows: T[], f: keyof T): WithMs<T>[] =>
    rows.map((r) => ({ ...r, ms: toMs(r[f] as unknown as string) }));

  const targets = withMs(
    (data.targets ?? []).filter((t) => !t._deleted),
    "effective_at",
  ).sort((a, b) => a.ms - b.ms);
  const campaigns = withMs(run(data.campaigns, "campaign_id", "campaigns"), "created_at");
  const daily = run(data.daily_marketing, "activity_id", "daily_marketing").map((r) => {
    const day = String(r.activity_date).slice(0, 10);
    return { ...r, activity_date: day, ms: endOfIstDay(day) };
  });
  const people = withMs(run(data.people, "person_id", "people"), "first_seen_at");
  const interactions = withMs(run(data.interactions, "interaction_id", "interactions"), "occurred_at");
  const registrations = withMs(run(data.registrations, "registration_id", "registrations"), "registered_at");
  const history = withMs(run(data.registration_history, "history_id", "registration_history"), "effective_at").sort(
    (a, b) => a.ms - b.ms || a.history_id.localeCompare(b.history_id),
  );
  const checkins = withMs(run(data.checkins, "event_id", "checkins"), "occurred_at");

  const p: Prepared = {
    data,
    settings: resolveSettings(data.settings),
    event,
    targets,
    campaigns,
    campaignById: new Map(campaigns.map((c) => [c.campaign_id, c])),
    daily,
    people,
    personById: new Map(people.map((x) => [x.person_id, x])),
    interactions,
    interactionsByPerson: group(interactions, (r) => r.person_id),
    registrations,
    regsByPerson: group(registrations, (r) => r.person_id),
    regById: new Map(registrations.map((r) => [r.registration_id, r])),
    history,
    historyByReg: group(history, (r) => r.registration_id),
    checkins,
    dedup,
    warnings,
  };
  cache.set(data, p);
  return p;
}
