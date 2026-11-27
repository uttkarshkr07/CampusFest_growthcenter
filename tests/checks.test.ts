// What stops a data load, and what loads with a warning.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATTENDEE, checkDataset, isDate, isDateTime, type Converted } from "@/lib/data/checks";
import { loadSeed } from "./seed";

type Row = Record<string, unknown>;

/** today's data in the shape the converter produces */
function workbooks(): Converted {
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
const run = (change: (w: Converted) => void = () => {}) => {
  const w = workbooks();
  change(w);
  return checkDataset(w, { accountOwnerIds: ["T01", "T03", "T06"], ticketId: (k) => `id-${k}` });
};
const errorText = (r: ReturnType<typeof run>) => r.errors.map((e) => `${e.sheet} ${e.row ?? ""} ${e.text}`).join("\n");

describe("dates", () => {
  it("accepts only real dates written in full", () => {
    expect([isDate("2025-02-28"), isDate("2025-02-30"), isDate("28/02/2025"), isDate("")]).toEqual([true, false, false, false]);
    expect([isDateTime("2025-04-12T10:00:00+05:30"), isDateTime("2025-04-12T10:00:00"), isDateTime("2025-02-30T10:00:00+05:30")]).toEqual([true, false, false]);
  });
});

describe("data check", () => {
  it("passes today's data and keeps every row, including copies", () => {
    const r = run();
    expect(errorText(r)).toBe("");
    expect([r.counts.original_people, r.counts.original_checkins, r.counts.original_tickets]).toEqual([3685, 3390, 1]);
    expect(r.originals.original_tickets[0]).toMatchObject({ id: "id-TK001", started_on: "2025-03-17" });
    expect(r.originals.original_people[0]).not.toHaveProperty("__row");
    expect(r.sponsor.brands[0]).not.toHaveProperty("__row");
  });

  it("stops on a missing column, an empty required value or an impossible required date", () => {
    expect(errorText(run((w) => (w.headers["attendee.people"] = w.headers["attendee.people"].filter((h) => h !== "person_type"))))).toMatch(/People 1 Missing column\(s\): person_type/);
    expect(errorText(run((w) => (w.attendee.checkins[0].event_id = null)))).toMatch(/Check-ins 2 event_id is empty/);
    expect(errorText(run((w) => (w.attendee.daily_marketing[0].activity_date = "2025-02-30")))).toMatch(/activity_date is not readable/);
    expect(errorText(run((w) => w.attendee.event.push({ ...w.attendee.event[0], __row: 3 })))).toMatch(/exactly one event/);
  });

  it("loads other unreadable values as empty, and says so", () => {
    let at = -1;
    const r = run((w) => {
      const ids = w.attendee.checkins.map((c) => c.event_id);
      at = ids.findIndex((id) => ids.indexOf(id) === ids.lastIndexOf(id)); // a scan with no exact copy
      w.attendee.checkins[at].occurred_at = "TBD";
      w.attendee.daily_marketing[0].marketing_spend_inr = "1,200";
    });
    expect(errorText(r)).toBe("");
    expect([r.originals.original_checkins[at].occurred_at, r.originals.original_daily_marketing[0].marketing_spend_inr]).toEqual([null, null]);
    expect(r.warnings.filter((x) => /will load as empty/.test(x.text)).map((x) => x.sheet).sort()).toEqual(["Check-ins", "Daily Marketing"]);
    expect(r.issues.some((i) => i.table === "checkins" && i.code === "unreadable_time" && i.records[0].row === at + 2)).toBe(true);
  });

  it("accepts anomalies that the app can show, and lists them with their Excel row", () => {
    const r = run((w) => {
      w.attendee.registrations[0].campaign_id = "C99";
      w.attendee.checkins[0].result = " Admitted ";
    });
    expect(errorText(r)).toBe("");
    expect(r.originals.original_checkins[0].result).toBe(" Admitted ");
    expect(r.issues.find((i) => i.table === "registrations" && i.code === "unknown_campaign_id")!.records[0].row).toBe(2);
  });

  it.each<[string, (t: Record<string, unknown>) => void, RegExp]>([
    ["both accepted and declined", (t) => (t.declined_on = "2025-03-18"), /both accepted and declined/],
    ["started without being accepted", (t) => (t.accepted_on = null), /started_on needs an accepted_on/],
    ["done before it started", (t) => (t.done_on = "2025-03-16"), /done_on needs a started_on/],
    ["needed before it was raised", (t) => (t.needed_by = "2025-03-01"), /needed_by is before raised_on/],
    ["sent to its own team", (t) => (t.to_team = "sponsorship"), /must be different/],
    ["without a raised date", (t) => (t.raised_on = null), /raised_on is required/],
    ["with an unknown team", (t) => (t.to_team = "finance"), /must be one of/],
  ])("stops on a ticket %s", (_, change, message) => {
    expect(errorText(run((w) => change(w.ops.tickets[0])))).toMatch(message);
  });

  it("stops on repeated ticket keys or owner ids", () => {
    expect(errorText(run((w) => w.ops.tickets.push({ ...w.ops.tickets[0], __row: 3 })))).toMatch(/ticket_key TK001 is used twice/);
    expect(errorText(run((w) => w.ops.team.push({ ...w.ops.team[0], __row: 9 })))).toMatch(/owner_id T01 is used twice/);
  });

  it("warns about people without a sign-in and dates outside the story", () => {
    const r = run((w) => {
      w.ops.team.push({ owner_id: "T09", owner_name: "New", team: "events", __row: 9 });
      w.ops.tickets[0].done_on = "2025-09-01";
    });
    expect(errorText(r)).toBe("");
    expect(r.warnings.map((x) => x.text).join("\n")).toMatch(/No sign-in account for T09[\s\S]*can never be selected/);
  });
});
