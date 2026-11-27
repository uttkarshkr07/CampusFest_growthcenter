// Today's data in the shape the converter produces.
import { readFileSync } from "node:fs";
import { ATTENDEE, type Converted } from "@/lib/data/checks";
import { loadSeed } from "./seed";

type Row = Record<string, unknown>;

export function workbooks(): Converted {
  const seed = loadSeed() as unknown as Record<string, Row[]>;
  const sponsor = JSON.parse(readFileSync("data/seed/sponsor.json", "utf8")) as Record<string, Row[]>;
  const numbered = (rows: Row[]) => rows.map((r, i) => ({ ...r, __row: i + 2 }));
  const out: Converted = { headers: {}, problems: [], attendee: {}, sponsor: {}, ops: {} };
  for (const table of Object.keys(ATTENDEE)) {
    if (table === "sponsor_activations") continue;
    out.attendee[table] = numbered(seed[table]);
    out.headers[`attendee.${table}`] = Object.keys(seed[table][0]);
  }
  for (const [sheet, rows] of Object.entries(sponsor)) {
    out.sponsor[sheet] = numbered(rows);
    out.headers[`sponsor.${sheet}`] = Object.keys(rows[0]);
  }
  const ops: Record<string, Row[]> = {
    team: [["T01", "A", "sponsorship"], ["T03", "B", "publicity"], ["T06", "C", "events"]].map(([owner_id, owner_name, team]) => ({ owner_id, owner_name, team })),
    settings: [{ key: "walkin_assumption", value: 900 }, { key: "story_today", value: "2025-03-15" }],
    campaign_plan: [{ campaign_id: "C01", app_status: "paused", budget_inr: 5000, notes: null }],
    tickets: [{ ticket_key: "TK001", title: "First", details: "d", from_team: "sponsorship", to_team: "publicity", requester_id: "T01", assignee_id: "T03", priority: "high", raised_on: "2025-03-15", needed_by: "2025-03-22", accepted_on: "2025-03-16", declined_on: null, decline_reason: null, started_on: "2025-03-17", done_on: null, simulation_note: null }],
  };
  const headers: Record<string, string[]> = { team: ["owner_id", "owner_name", "team"], settings: ["key", "value"], campaign_plan: ["campaign_id", "app_status", "budget_inr", "notes"], tickets: Object.keys(ops.tickets[0]) };
  for (const [key, rows] of Object.entries(ops)) {
    out.ops[key] = numbered(rows);
    out.headers[`ops.${key}`] = headers[key];
  }
  return out;
}
