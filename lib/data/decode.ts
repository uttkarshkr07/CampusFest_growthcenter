// Turns pages of {cols, rows} back into the app's rows. The database leaves out the repeated
// person, campaign and owner names; they are filled in from the ids here, sharing one string each.
import type { Dataset } from "@/lib/engine/types";

export const PAGED_TABLES = ["daily_marketing", "people", "interactions", "registrations", "registration_history", "checkins"] as const;
export type PagedTable = (typeof PAGED_TABLES)[number];

export interface Columns {
  cols: string[];
  rows: unknown[][];
}

export const PAGE_ROWS = 20000;

/** row-id ranges that cover [min, max]; none for an empty table */
export function pageRanges(min: number, max: number, size = PAGE_ROWS): [number, number][] {
  const out: [number, number][] = [];
  for (let from = min; from <= max; from += size) out.push([from, Math.min(max, from + size - 1)]);
  return out;
}

export function toRows(table: Columns): Record<string, unknown>[] {
  const { cols } = table;
  return table.rows.map((values) => {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = values[i];
    return row;
  });
}

type SmallTables = Pick<Dataset, "campaigns" | "team">;

export function fillNames(small: SmallTables, big: Record<PagedTable, Record<string, unknown>[]>) {
  const campaign = new Map(small.campaigns.map((c) => [c.campaign_id, c.campaign_name]));
  const owner = new Map(small.team.map((t) => [t.owner_id, t.owner_name]));
  const person = new Map(big.people.map((p) => [p.person_id as string, p.person_name]));
  const named = (map: Map<string, unknown>, id: unknown) => (typeof id === "string" ? (map.get(id) ?? null) : null);
  for (const table of PAGED_TABLES) {
    for (const row of big[table]) {
      if (table === "people") row.first_campaign_name = named(campaign, row.first_campaign_id);
      else {
        row.campaign_name = named(campaign, row.campaign_id);
        if (table !== "daily_marketing") row.person_name = named(person, row.person_id);
      }
      row.owner_name = named(owner, row.owner_id);
    }
  }
}
