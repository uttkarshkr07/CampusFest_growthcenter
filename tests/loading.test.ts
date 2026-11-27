// Paged loading must give the app exactly what the single full load gave it. The "database" here is
// built from the column lists written in the database file, so the two cannot drift apart unnoticed.
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import * as E from "@/lib/engine";
import { PAGED_TABLES, pageRanges, type PagedTable } from "@/lib/data/decode";
import { loadDataset } from "@/lib/data/load";
import { loadSeed } from "./seed";

const sql = readFileSync("supabase/patch_session3e_scale.sql", "utf8").replace(/\r\n/g, "\n");

/** for each table: the names sent to the app, and the columns actually read, in order */
const sqlColumns = Object.fromEntries(
  [...sql.matchAll(/json_build_object\('cols', json_build_array\(([^)]*)\),\n\s*'rows', coalesce\(json_agg\(json_build_array\(([^)]*)\) order by x\._row_id\)[^\n]*\n\s*into v from public\.(\w+) x/g)].map((m) => [
    m[3],
    { names: m[1].split(",").map((s) => s.trim().replace(/'/g, "")), read: m[2].split(",").map((s) => s.trim().replace(/^x\./, "")) },
  ]),
) as Record<PagedTable, { names: string[]; read: string[] }>;

function seedWithIds(): E.Dataset {
  const d = loadSeed();
  for (const t of PAGED_TABLES) (d[t] as unknown as Record<string, unknown>[]).forEach((r, i) => Object.assign(r, { _row_id: i + 1, _source: "original", _deleted: false }));
  const names: [string, string][] = [["T01", "Riya Kapoor"], ["T02", "Kabir Shah"], ["T03", "Meera Iyer"], ["T04", "Arjun Verma"], ["T05", "Nisha Rao"], ["T06", "Dev Malhotra"]];
  d.team = names.map(([owner_id, owner_name]) => ({ owner_id, owner_name, team: "publicity" }));
  return d;
}

function fakeDb(d: E.Dataset, options: { failFirst?: boolean; oldDatabase?: boolean } = {}) {
  const calls: string[] = [];
  let failed = false;
  const db = {
    rpc: async (name: string, args?: { p_table: PagedTable; p_from: number; p_to: number }) => {
      calls.push(args ? `${name}:${args.p_table}:${args.p_from}` : name);
      if (options.oldDatabase && name === "get_app_data") return { data: null, error: { message: "Could not find the function public.get_app_data in the schema cache" } };
      if (name === "get_dataset") return { data: d, error: null };
      if (name === "get_app_data") {
        const tables = Object.fromEntries(Object.entries(d).filter(([k]) => !(PAGED_TABLES as readonly string[]).includes(k)));
        const ranges = Object.fromEntries(PAGED_TABLES.map((t) => [t, [1, d[t].length, d[t].length]]));
        return { data: { versions: Object.fromEntries(PAGED_TABLES.map((t) => [t, "a:1"])), ranges, tables }, error: null };
      }
      if (options.failFirst && !failed) {
        failed = true;
        return { data: null, error: { message: "TypeError: fetch failed" } };
      }
      const { p_table, p_from, p_to } = args!;
      const { names, read } = sqlColumns[p_table];
      const rows = (d[p_table] as unknown as Record<string, unknown>[]).filter((r) => (r._row_id as number) >= p_from && (r._row_id as number) <= p_to);
      return { data: { cols: names, rows: rows.map((r) => read.map((c) => r[c] ?? null)) }, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("the database file's page query", () => {
  it("sends each table's columns under their own names", () => {
    expect(Object.keys(sqlColumns).sort()).toEqual([...PAGED_TABLES].sort());
    for (const t of PAGED_TABLES) expect(sqlColumns[t].names).toEqual(sqlColumns[t].read);
  });
  it("leaves out only the repeated names", () => {
    const d = seedWithIds();
    for (const t of PAGED_TABLES) {
      const missing = Object.keys(d[t][0]).filter((k) => !sqlColumns[t].names.includes(k));
      const repeated = t === "people" ? ["first_campaign_name", "owner_name"] : t === "daily_marketing" ? ["campaign_name", "owner_name"] : ["person_name", "campaign_name", "owner_name"];
      expect(missing.sort()).toEqual(repeated.sort());
    }
  });
});

describe("paged loading", () => {
  it("splits row ids into ranges", () => {
    expect(pageRanges(1, 5, 2)).toEqual([[1, 2], [3, 4], [5, 5]]);
    expect(pageRanges(0, -1)).toEqual([]);
  });

  it("gives the same rows, names and figures as the full load", async () => {
    const source = seedWithIds();
    const progress: string[] = [];
    const { data } = await loadDataset(fakeDb(source).db, "original", (p) => progress.push(p));
    for (const t of PAGED_TABLES) {
      expect(data[t].length).toBe(source[t].length);
      const [got, want] = [data[t], source[t]] as unknown as Record<string, unknown>[][];
      const different = want.findIndex((row, i) => Object.keys(row).some((k) => (got[i][k] ?? null) !== (row[k] ?? null)));
      expect([t, different]).toEqual([t, -1]);
    }
    expect(E.buildSummary(data, "2025-04-20")).toEqual(E.buildSummary(source, "2025-04-20"));
    expect(E.buildSummary(data, "2025-03-15")).toEqual(E.buildSummary(source, "2025-03-15"));
    expect(progress.some((p) => p.includes("100%"))).toBe(true);
  }, 60000);

  it("tries a dropped page again", async () => {
    const { db, calls } = fakeDb(seedWithIds(), { failFirst: true });
    const { data } = await loadDataset(db, "original", () => {});
    expect(data.people.length).toBe(3685);
    const pages = calls.filter((c) => c.startsWith("get_rows"));
    expect(pages.length).toBe(new Set(pages).size + 1);
  }, 60000);

  it("still works before the database file is run", async () => {
    const { db, calls } = fakeDb(seedWithIds(), { oldDatabase: true });
    await loadDataset(db, "original", () => {});
    expect(calls).toEqual(["get_app_data", "get_dataset"]);
  });

  it("today's repeated names all match their ids", () => {
    expect(E.dataQuality(seedWithIds()).filter((i) => i.code === "name_mismatch")).toEqual([]);
  });
});
