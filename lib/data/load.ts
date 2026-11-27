// Loads the dataset. Big tables come in pages and are kept in the browser, so a table is downloaded
// again only after it has changed. The database still checks the sign-in on every load.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetData, Dataset } from "@/lib/engine/types";
import { rpcName, tableName, type DatasetId } from "@/lib/datasets";
import { PAGED_BET_TABLES, type PagedBetTable } from "./bet-spec";
import { PAGED_TABLES, fillNames, pageRanges, toRows, type Columns, type PagedTable } from "./decode";

const PARALLEL = 3;
const ATTEMPTS = 3;

interface Cached extends Columns {
  version: string;
}

/** A small key-value store in the browser. If it is unavailable or full, loading still works. */
function openCache(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open("cfgc-data", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("tables");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}
function cacheGet(db: IDBDatabase | null, key: string): Promise<Cached | null> {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const req = db.transaction("tables", "readonly").objectStore("tables").get(key);
      req.onsuccess = () => resolve((req.result as Cached | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
function cachePut(db: IDBDatabase | null, key: string, value: Cached) {
  if (!db) return;
  try {
    db.transaction("tables", "readwrite").objectStore("tables").put(value, key);
  } catch {
    /* storage full or blocked: the next visit downloads again */
  }
}

/** a slow or dropped request is tried again before giving up */
async function withRetry<T>(what: string, run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { data, error } = await run();
    if (!error && data != null) return data as T;
    last = error?.message ?? "empty reply (is this account allowed to read the data?)";
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  throw new Error(`${what}: ${last}`);
}

interface AppData {
  versions: Record<string, string>;
  ranges: Record<PagedTable | PagedBetTable, [number, number, number]>;
  tables: Omit<Dataset, PagedTable>;
  /** the small bet tables: simulated dataset only */
  bets?: Partial<BetData>;
}

export interface Loaded {
  data: Dataset;
  /** the keys the server sent, to tell which database patches are in place */
  hasTickets: boolean;
}

export async function loadDataset(db: SupabaseClient, dataset: DatasetId, onProgress: (text: string) => void): Promise<Loaded> {
  const simulated = dataset === "simulated";
  const headName = rpcName(dataset, "get_app_data");
  const head = await db.rpc(headName);
  // before the large-data patch: one request for everything, as before
  if (!simulated && head.error && /could not find the function|does not exist/i.test(head.error.message)) {
    const all = await withRetry<Dataset>("Loading the data", () => db.rpc("get_dataset"));
    return { data: all, hasTickets: "tickets" in all };
  }
  const app = head.error || !head.data ? await withRetry<AppData>("Loading the data", () => db.rpc(headName)) : (head.data as AppData);
  const paged: readonly (PagedTable | PagedBetTable)[] = simulated ? [...PAGED_TABLES, ...PAGED_BET_TABLES] : PAGED_TABLES;

  const cache = await openCache();
  const total = paged.reduce((a, t) => a + app.ranges[t][2], 0);
  let done = 0;
  const progress = () => onProgress(`Loading the dataset: ${total ? Math.round((done / total) * 100) : 100}% of ${total.toLocaleString("en-IN")} rows`);
  progress();

  const jobs: (() => Promise<void>)[] = [];
  const big = {} as Record<PagedTable | PagedBetTable, Columns>;
  const fetched: { table: PagedTable | PagedBetTable; pages: Columns[] }[] = [];
  for (const table of paged) {
    const version = app.versions[table] ?? "";
    // each dataset keeps its own copy, under the database's table name
    const kept = await cacheGet(cache, tableName(dataset, table));
    if (kept && version && kept.version === version && kept.rows.length === app.ranges[table][2]) {
      big[table] = kept;
      done += kept.rows.length;
      continue;
    }
    const ranges = pageRanges(app.ranges[table][0], app.ranges[table][1]);
    const pages: Columns[] = new Array(ranges.length);
    fetched.push({ table, pages });
    ranges.forEach(([from, to], i) =>
      jobs.push(async () => {
        pages[i] = await withRetry<Columns>(`Loading ${table.replace(/_/g, " ")}`, () => db.rpc(rpcName(dataset, "get_rows"), { p_table: table, p_from: from, p_to: to }));
        done += pages[i].rows.length;
        progress();
      }),
    );
  }
  progress();
  let next = 0;
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < jobs.length) await jobs[next++]();
    }),
  );
  for (const { table, pages } of fetched) {
    big[table] = { cols: pages[0]?.cols ?? [], rows: pages.flatMap((p) => p.rows) };
    cachePut(cache, tableName(dataset, table), { ...big[table], version: app.versions[table] ?? "" });
  }

  onProgress("Preparing the figures...");
  const rows = Object.fromEntries(PAGED_TABLES.map((t) => [t, toRows(big[t])])) as Record<PagedTable, Record<string, unknown>[]>;
  fillNames(app.tables, rows);
  const bets = simulated ? ({ ...app.bets, ...Object.fromEntries(PAGED_BET_TABLES.map((t) => [t, toRows(big[t])])) } as BetData) : undefined;
  return { data: { ...app.tables, ...rows, ...(bets ? { bets } : {}) } as unknown as Dataset, hasTickets: true };
}
