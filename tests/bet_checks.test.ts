// The loader's checks on the simulated workbooks: every new sheet, and every rule.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASS_CAP, betIssues, type BetSource } from "@/lib/data/bet-checks";
import { BET_TABLES, BET_TABLE_NAMES, SIMULATED_EXTRA_COLUMNS, type BetTableName } from "@/lib/data/bet-spec";
import { checkDataset, type Converted } from "@/lib/data/checks";
import { estimateSize } from "@/lib/data/size";
import { betSheets } from "./bet_fixture";
import { workbooks } from "./workbooks";

type Row = Record<string, unknown>;

function simulatedWorkbooks(): Converted {
  const w = workbooks();
  const { bets, headers } = betSheets();
  w.bets = bets;
  Object.assign(w.headers, headers);
  for (const [table, added] of Object.entries(SIMULATED_EXTRA_COLUMNS)) w.headers[`attendee.${table}`] = [...w.headers[`attendee.${table}`], ...added];
  return w;
}
const run = (change: (w: Converted) => void = () => {}, dataset: "original" | "simulated" = "simulated") => {
  const w = simulatedWorkbooks();
  change(w);
  return checkDataset(w, { accountOwnerIds: ["T01", "T03", "T06"], ticketId: (k) => `id-${k}`, dataset });
};
const errorText = (r: ReturnType<typeof run>) => r.errors.map((e) => `${e.sheet} ${e.row ?? ""} ${e.text}`).join("\n");
/** "table:code" of every problem record found in the bet rules */
const found = (r: ReturnType<typeof run>) => new Set(r.issues.map((i) => `${i.table}:${i.code}`));
const baseline = found(run());
const added = (change: (w: Converted) => void) => {
  const r = run(change);
  expect(errorText(r)).toBe("");
  return [...found(r)].filter((k) => !baseline.has(k)).sort();
};
const first = (w: Converted, t: BetTableName) => w.bets![t][0];
const again = (w: Converted, t: BetTableName, change: Row) => w.bets![t].push({ ...first(w, t), ...change, __row: 90 });

describe("the simulated workbooks", () => {
  it("pass as they are, with every new sheet and column, in database types", () => {
    const r = run();
    expect(errorText(r)).toBe("");
    for (const t of BET_TABLE_NAMES) {
      expect(r.counts[`original_${t}`], t).toBe(1);
      expect(Object.keys(r.originals[`original_${t}`][0]), t).toEqual(Object.keys(BET_TABLES[t].columns));
    }
    expect(r.originals.original_venues[0].seated).toBe(true);
    expect(r.originals.original_program_events[0]).toMatchObject({ scored: false, booking_required: true, seats_offered: 1 });
    expect(r.originals.original_registrations[0]).toHaveProperty("route", null);
    expect(r.originals.original_people[0]).toHaveProperty("college_id", null);
    expect([...baseline].filter((k) => BET_TABLE_NAMES.some((t) => k.startsWith(`${t}:`)))).toEqual([]);
  });

  it("the original takes none of the new sheets or columns", () => {
    const r = run((w) => (w.attendee.registrations[0].route = "squad"), "original");
    expect(errorText(r)).toBe("");
    expect(Object.keys(r.counts)).not.toContain("original_passes");
    expect(r.originals.original_registrations[0]).not.toHaveProperty("route");
    expect(r.warnings.some((x) => x.sheet === "Registrations" && /not loaded: route/.test(x.text))).toBe(true);
  });

  it("need the new columns on People and Registrations", () => {
    expect(errorText(run((w) => (w.headers["attendee.registrations"] = w.headers["attendee.registrations"].filter((h) => h !== "route"))))).toMatch(/Registrations 1 Missing column\(s\): route/);
  });

  it.each(BET_TABLE_NAMES)("%s: stops on a missing sheet, column or id", (t) => {
    const { sheet, columns, required } = BET_TABLES[t];
    expect(errorText(run((w) => { delete w.bets![t]; delete w.headers[`bets.${t}`]; }))).toContain(`${sheet}  The sheet is missing`);
    const lastColumn = Object.keys(columns).at(-1)!;
    expect(errorText(run((w) => (w.headers[`bets.${t}`] = w.headers[`bets.${t}`].filter((h) => h !== lastColumn))))).toContain(`Missing column(s): ${lastColumn}`);
    expect(errorText(run((w) => (first(w, t)[required[0]] = null)))).toContain(`${sheet} 2 ${required[0]} is empty`);
  });

  it("allow an empty sheet", () => {
    expect(errorText(run((w) => { for (const t of BET_TABLE_NAMES) w.bets![t] = []; }))).toBe("");
  });

  it("load unreadable values as empty, and say so", () => {
    const r = run((w) => { first(w, "passes").booked_at = "TBD"; first(w, "venues").seated = "maybe"; });
    expect(errorText(r)).toBe("");
    expect([r.originals.original_passes[0].booked_at, r.originals.original_venues[0].seated]).toEqual([null, null]);
    expect(r.warnings.filter((x) => /will load as empty/.test(x.text)).map((x) => x.sheet).sort()).toEqual(["Passes", "Venues"]);
  });
});

describe("planned anomalies load, and are listed", () => {
  it.each<[string, (w: Converted) => void, string]>([
    ["an unknown college type", (w) => (first(w, "colleges").college_type = "abroad"), "colleges:unknown_college_type"],
    ["a contingent of an unknown college", (w) => (first(w, "contingents").college_id = "COL9"), "contingents:unknown_college_id"],
    ["a tier with the wrong slots", (w) => (first(w, "contingent_tier_events").discounted_slots = 99), "contingent_tier_events:tier_slots"],
    ["a squad led by nobody known", (w) => (first(w, "squads").leader_person_id = "E9999"), "squads:unknown_leader_person_id"],
    ["a lock before the booking", (w) => (first(w, "passes").locked_in_at = "2025-03-01T10:00:00+05:30"), "passes:lock_before_booking"],
    ["a cancellation before the booking", (w) => (first(w, "passes").cancelled_at = "2025-03-01T10:00:00+05:30"), "passes:cancel_before_booking"],
    ["an unknown payment kind", (w) => (first(w, "payments").kind = "cash"), "payments:unknown_kind"],
    ["a perk for an unknown pass", (w) => (first(w, "perk_grants").pass_id = "PASS9"), "perk_grants:unknown_pass_id"],
    ["an unknown claim decision", (w) => (first(w, "insurance_claims").decision = "maybe"), "insurance_claims:unknown_decision"],
    ["two venues sharing an id", (w) => again(w, "venues", { venue_name: "Other" }), "venues:conflicting_id"],
    ["more seats than the venue holds", (w) => (first(w, "program_events").seats_offered = 500), "program_events:seats_over_capacity"],
    ["an event that ends before it starts", (w) => (first(w, "program_events").ends_at = "2025-04-12T09:00:00+05:30"), "program_events:ends_before_start"],
    ["more bookings than seats", (w) => again(w, "seat_booking_history", { history_id: "BH2", booking_id: "BK2" }), "seat_booking_history:overbooked"],
    ["a scan for an unknown event", (w) => (first(w, "seat_scans").event_id = "E999"), "seat_scans:unknown_event_id"],
    ["an unknown waitlist kind", (w) => (first(w, "waitlist_entries").kind = "bed"), "waitlist_entries:unknown_kind"],
    ["an offer window of 15 minutes", (w) => (first(w, "exchange_offers").expires_at = "2025-04-03T10:15:00+05:30"), "exchange_offers:offer_window"],
    ["an offer both claimed and expired", (w) => (first(w, "exchange_offers").claimed_at = "2025-04-03T10:05:00+05:30"), "exchange_offers:claimed_and_expired"],
    ["position 6", (w) => (first(w, "competition_results").position = 6), "competition_results:position"],
    ["an unknown hackathon status", (w) => (first(w, "hackathon_teams").status = "maybe"), "hackathon_teams:unknown_status"],
    ["a member of an unknown team", (w) => (first(w, "hackathon_members").team_id = "HT9"), "hackathon_members:unknown_team_id"],
    ["a bet outside B1 to B5", (w) => again(w, "bets", { bet_id: "B9" }), "bets:unknown_bet_id"],
    ["an unknown threshold direction", (w) => (first(w, "bet_thresholds").direction = "up"), "bet_thresholds:unknown_direction"],
    ["a milestone of an unknown bet", (w) => (first(w, "bet_milestones").bet_id = "B4"), "bet_milestones:unknown_bet_id"],
    ["spend on an unknown bet", (w) => (first(w, "bet_spend").bet_id = "B4"), "bet_spend:unknown_bet_id"],
    ["an unknown route", (w) => (w.attendee.registrations[0].route = "walk"), "registrations:unknown_route"],
  ])("%s", (_, change, code) => {
    expect(added(change)).toContain(code);
  });

  it("covers every new sheet above", () => {
    const covered = readFileSync("tests/bet_checks.test.ts", "utf8");
    for (const t of BET_TABLE_NAMES) expect(covered, t).toContain(`"${t}:`);
  });

  it("capital letters and spaces in fixed words are not a problem", () => {
    expect(added((w) => { first(w, "payments").kind = " Booking "; first(w, "colleges").outreach_wave = "a"; })).toEqual([]);
  });

  it("a seat given up and taken again is not an overbooking; an exact copy is not a conflict", () => {
    expect(
      added((w) => {
        again(w, "seat_booking_history", { history_id: "BH2", status: "cancelled", effective_at: "2025-04-02T10:00:00+05:30" });
        again(w, "seat_booking_history", { history_id: "BH3", booking_id: "BK2", effective_at: "2025-04-02T11:00:00+05:30" });
        again(w, "venues", {});
      }),
    ).toEqual([]);
  });
});

describe("rules that look across sheets", () => {
  const attendee = (people: Row[], registrations: Row[], checkins: Row[] = []) => ({
    event: [{ event_starts_at: "2025-04-12T10:00:00+05:30", event_ends_at: "2025-04-13T23:00:00+05:30" }],
    people,
    registrations,
    checkins,
    ownerIds: new Set(["T03"]),
  });
  const empty = () => Object.fromEntries(BET_TABLE_NAMES.map((t) => [t, []])) as unknown as BetSource;
  const ids = [1, 2, 3, 4, 5, 6];
  const people = ids.map((i) => ({ person_id: `P${i}`, person_type: "external" }));
  const squad = (n: number) => ids.slice(0, n).map((i) => ({ registration_id: `R${i}`, person_id: `P${i}`, squad_id: "SQ1" }));
  const scan = (i: number) => ({ person_id: `P${i}`, result: "admitted", verification: "verified", occurred_at: "2025-04-12T12:00:00+05:30" });
  const codes = (b: BetSource, a: ReturnType<typeof attendee>) => betIssues(b, a).map((i) => i.code);

  it("a squad holds at most five", () => {
    const b = empty();
    b.squads = [{ squad_id: "SQ1" }];
    expect(codes(b, attendee(people, squad(5)))).toEqual([]);
    expect(codes(b, attendee(people, squad(6)))).toEqual(["squad_too_big"]);
  });

  it("cashback needs five qualifying scans", () => {
    const b = empty();
    b.squads = [{ squad_id: "SQ1" }];
    b.passes = [{ pass_id: "PASS1", registration_id: "R1", person_id: "P1" }];
    b.payments = [{ payment_id: "PAY1", pass_id: "PASS1", kind: "squad_cashback" }];
    expect(codes(b, attendee(people, squad(5), [1, 2, 3, 4, 5].map(scan)))).toEqual([]);
    expect(codes(b, attendee(people, squad(5), [1, 2, 3, 4].map(scan)))).toEqual(["cashback_without_full_squad"]);
    // a denied scan, and one before the gates open, do not count
    const bad = [...[1, 2, 3, 4].map(scan), { ...scan(5), result: "denied" }, { ...scan(5), occurred_at: "2025-04-10T12:00:00+05:30" }];
    expect(codes(b, attendee(people, squad(5), bad))).toEqual(["cashback_without_full_squad"]);
  });

  it("counts external passes valid at the same time against the cap", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ pass_id: `X${i}`, person_id: `Q${i}`, booked_at: "2025-03-01T10:00:00+05:30" }));
    const crowd = Array.from({ length: PASS_CAP + 2 }, (_, i) => ({ person_id: `Q${i}`, person_type: i === PASS_CAP + 1 ? "staff" : "external" }));
    const b = empty();
    b.passes = many(PASS_CAP);
    expect(codes(b, attendee(crowd, []))).toEqual([]);
    b.passes = many(PASS_CAP + 1);
    expect(codes(b, attendee(crowd, []))).toEqual(["pass_cap"]);
    // one cancelled before the last was sold: never over; a staff pass does not count
    b.passes = [...many(PASS_CAP), { pass_id: "LATE", person_id: `Q${PASS_CAP}`, booked_at: "2025-03-03T10:00:00+05:30" }, { pass_id: "S", person_id: `Q${PASS_CAP + 1}`, booked_at: "2025-03-01T10:00:00+05:30" }];
    b.passes[0] = { ...b.passes[0], cancelled_at: "2025-03-02T10:00:00+05:30" };
    expect(codes(b, attendee(crowd, []))).toEqual([]);
  });
});

describe("the workbook converter and the size estimate", () => {
  it("the converter reads the same sheets and treats the same columns as dates", () => {
    const py = readFileSync("scripts/dataset_to_json.py", "utf8");
    const set = (name: string) => new Set([...new RegExp(`^${name} = \\{([\\s\\S]*?)\\}`, "m").exec(py)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]));
    const [dates, times] = [set("DATE"), set("DATETIME")];
    for (const t of BET_TABLE_NAMES) {
      expect(py, t).toContain(`"${t}": "${BET_TABLES[t].sheet}"`);
      for (const [column, kind] of Object.entries(BET_TABLES[t].columns)) {
        expect(dates.has(column), `${t}.${column} as a date`).toBe(kind === "date");
        expect(times.has(column), `${t}.${column} as a time`).toBe(kind === "datetime");
      }
    }
  });

  it("matches the one measured size: the original at about 30 MB with the empty database", () => {
    const { datasetMb } = estimateSize(run(() => {}, "original").counts);
    expect(11 + datasetMb).toBeGreaterThan(26);
    expect(11 + datasetMb).toBeLessThan(34);
  });
});
