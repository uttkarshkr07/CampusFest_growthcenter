// Bet tracker, campus map and Championship against figures worked out by hand (tests/p5_fixture.ts).
import { describe, expect, it } from "vitest";
import shippedProgram from "@/lib/data/program.json";
import { hrefFor } from "@/lib/copilot/targets";
import { betTracker, championship, judge, kpi, programView, tiePoints, viewAsOf, type Dataset } from "@/lib/engine";
import { at, p5Fixture } from "./p5_fixture";
import { loadSeed } from "./seed";

const data = p5Fixture();
const k = (id: string, day: string, d: Dataset = data) => kpi(d, `2025-${day}`, id).value;

describe("each KPI, by hand", () => {
  it.each([
    // id, selected date, value, verdict
    ["K02", "03-01", 1, "change"], // 1 signed of 3 visited
    ["K03", "03-15", 3, "change"],
    ["K05", "04-20", 100, "scale"], // both locked-in contingent members came
    ["K06", "03-15", 50, "scale"], // 5 squad of 10 non-contingent
    ["K07", "04-02", 100, "scale"],
    ["K09", "03-15", (100 * 11) / 12, "scale"], // P12 is under 7 days old; P11 never paid
    ["K10", "03-25", 20, "stop"], // P01, P02 of 10 two-step bookings
    ["K11", "04-02", 90, "scale"],
    ["K13", "04-01", 10, "stop"], // 1 claim on 10 locked passes, lower is better
    ["K14", "04-20", (100 * 8) / 9, "change"], // P10 voided; P14 never admitted
    ["K15", "04-07", 50, "change"], // in 10 minutes: O1 and O5 of 4 ended
    ["K16", "04-20", (100 * 2) / 6, "stop"],
    ["K19", "03-31", 2, "stop"],
    ["K22", "04-20", (100 * (500 + 401 + 125)) / 5198, "stop"],
  ] as const)("%s at %s", (id, day, value, verdict) => {
    const r = k(id, day);
    expect(r.value).toBeCloseTo(value, 5);
    expect(r.verdict).toBe(verdict);
  });

  it("K04 lists each college with its owner", () => {
    const r = k("K04", "04-20");
    expect(r.value).toBe(75); // 3 of 4 contingent members paid
    expect(r.breakdown!.rows.map((x) => [x.id, x.ownerId, ...x.cells.slice(1)])).toEqual([
      ["COL2", "T02", "1", "0%", "0", "none"],
      ["COL1", "T01", "3", "100%", "2", "50"],
    ]);
  });

  it("K08 counts the cashback and flags one paid to an incomplete squad", () => {
    const r = k("K08", "04-20");
    expect(r.value).toBe(100);
    expect(r.numbers.join(" ")).toContain("INR 500 in 5 payment(s)");
    expect(r.warnings).toEqual([]);
    const short = p5Fixture();
    short.checkins = short.checkins.filter((c) => c.person_id !== "P09");
    expect(k("K08", "04-20", short).warnings[0]).toContain("5 cashback payment(s)");
  });

  it("K12 reads the two-step arm from the passes and says when it is not readable", () => {
    const r = k("K12", "04-20");
    expect(r.verdict).toBe("not_enough_data");
    expect(r.numbers[0]).toContain("two-step arm (treatment) 1 of 1");
    expect(r.numbers[1]).toContain("Attended");
    expect(r.numbers[0]).toContain("not readable");
  });

  it("K13 shows approved refunds only after the decision", () => {
    expect(k("K13", "04-01").numbers[1]).toContain("Approved refunds INR 0");
    // judged on 1 Apr, so the later approval does not change the frozen figures
    expect(k("K13", "04-10").judgedOn).toBe("2025-04-01");
  });

  it("K14 gate rescue: one of two people stopped at the gate got in", () => {
    expect(k("K14", "04-20").numbers[1]).toContain("1 of 2");
  });

  it("K17 is not applicable while the cap is not reached", () => {
    expect(k("K17", "04-20")).toMatchObject({ verdict: "not_applicable" });
    expect(k("K17", "04-20").note).toContain("cap has not been reached");
  });

  it("K18 is judged at the due date and keeps the simulated label", () => {
    expect(k("K18", "03-21").verdict).toBe("too_early");
    expect(k("K18", "03-22")).toMatchObject({ verdict: "scale", action: null });
    const late = p5Fixture();
    late.bets!.bet_milestones[0].done_on = "2025-03-25";
    expect(k("K18", "04-01", late).verdict).toBe("stop");
    expect(betTracker(data, "2025-03-01").value.bets[4].simulationNote).toContain("SIMULATED SCENARIO");
  });

  it("K20 uses the planned route rates, and drops unlocked people after 2 Apr", () => {
    // 15 Mar: contingent 3 booked; squad 5 booked; individual 1 locked, 2 booked, 2 unpaid
    const mid = (3 * 0.92 * 0.92 + 5 * 0.88 * 0.94 + (0.9 + 2 * 0.85 * 0.9 + 2 * 0.7 * 0.85 * 0.9)) * 1.065;
    expect(k("K20", "03-15").value).toBe(Math.round(mid));
    // 3 Apr: 2 + 5 + 3 locked in, plus 2 hackathon participants new to the fest
    expect(k("K20", "04-03").value).toBe(Math.round((2 * 0.92 + 5 * 0.94 + 3 * 0.9) * 1.065 + 2));
    const changed = p5Fixture();
    changed.settings = [{ key: "k20_mid_squad_showup", value: 0.5 }];
    expect(k("K20", "04-03", changed).value).toBeLessThan(k("K20", "04-03").value!);
  });

  it("adds up bet spend to date and flags a budget overrun", () => {
    expect(betTracker(data, "2025-04-09").value.bets[0]).toMatchObject({ spent: 600, overBudget: false, spendPerModelled: 60 });
    expect(betTracker(data, "2025-04-10").value.bets[0]).toMatchObject({ spent: 1200, overBudget: true });
    expect(betTracker(data, "2025-04-10").value.spend).toMatchObject({ bets: 1200, media: 5000, total: 6200, over: false });
  });
});

describe("verdicts", () => {
  const higher = { direction: "higher" as const, scaleAt: 55, stopAt: 40 };
  const lowerIs = { direction: "lower" as const, scaleAt: 2, stopAt: 3 };
  it("puts the boundaries where the spec does, in both directions", () => {
    expect([judge(55, higher), judge(54.9, higher), judge(40, higher), judge(39.9, higher)]).toEqual(["scale", "change", "change", "stop"]);
    expect([judge(2, lowerIs), judge(2.1, lowerIs), judge(3, lowerIs), judge(3.1, lowerIs)]).toEqual(["scale", "change", "change", "stop"]);
  });

  it("says Too early before the check date, then Not enough data below the sample", () => {
    expect(k("K09", "03-14")).toMatchObject({ verdict: "too_early", action: null });
    const strict = p5Fixture();
    strict.bets!.bet_thresholds.find((t) => t.kpi_id === "K09")!.min_sample = 200;
    expect(k("K09", "03-15", strict).verdict).toBe("not_enough_data");
  });

  it("judges a dated check on the data of that date and shows the latest value beside it", () => {
    const r = k("K03", "03-25"); // P04 registered on 22 Mar
    expect(r).toMatchObject({ value: 3, verdict: "change", judgedOn: "2025-03-15", latest: "4", action: "K03 change action" });
  });

  it("lets the latest lead check reached speak for the bet", () => {
    expect(betTracker(data, "2025-03-10").value.bets[0].headline).toEqual({ kpiId: "K02", verdict: "change" });
    expect(betTracker(data, "2025-03-15").value.bets[0].headline).toEqual({ kpiId: "K03", verdict: "change" });
  });

  it("recalculates when a threshold is edited", () => {
    const edited = p5Fixture();
    edited.bets!.bet_thresholds.find((t) => t.kpi_id === "K03")!.scale_at = 3;
    expect(k("K03", "03-15", edited).verdict).toBe("scale");
  });

  it("is not applicable when a needed table is empty", () => {
    const bare = p5Fixture();
    bare.bets!.squads = [];
    expect(k("K07", "04-20", bare).verdict).toBe("not_applicable");
  });
});

describe("nothing after the selected date", () => {
  const dates = ["2025-02-15", "2025-03-15", "2025-04-02", "2025-04-05", "2025-04-12"];
  const snapshotAt = (d: Dataset, day: string) => JSON.stringify([betTracker(d, day).value, programView(d, day).value, championship(d, day).value]);

  /** the same run with every record dated after `day` removed or blanked by hand */
  function truncated(day: string): Dataset {
    const d = p5Fixture();
    const end = Date.parse(`${day}T23:59:59.999+05:30`);
    const after = (v: unknown) => typeof v === "string" && Date.parse(v.length === 10 ? `${v}T23:59:59.999+05:30` : v) > end;
    const keep = (rows: object[], column: string) => (rows as Record<string, unknown>[]).filter((r) => !after(r[column]));
    d.registrations = keep(d.registrations, "registered_at") as never;
    d.registration_history = keep(d.registration_history, "effective_at") as never;
    d.checkins = keep(d.checkins, "occurred_at") as never;
    d.daily_marketing = keep(d.daily_marketing, "activity_date") as never;
    const b = d.bets!;
    const owned = { contingents: "registered_at", contingent_tier_events: "reached_at", squads: "created_at", payments: "paid_at", insurance_claims: "filed_at", seat_booking_history: "effective_at", seat_scans: "occurred_at", waitlist_entries: "joined_at", exchange_offers: "offered_at", competition_results: "recorded_at", hackathon_teams: "registered_at", bet_spend: "spent_on", passes: "booked_at" } as const;
    for (const [table, column] of Object.entries(owned)) b[table as keyof typeof owned] = keep(b[table as keyof typeof owned], column) as never;
    for (const rows of Object.values(b))
      for (const r of rows as Record<string, unknown>[])
        for (const column of ["visited_on", "signed_on", "locked_in_at", "qr_voided_at", "decided_at", "claimed_at", "expired_at", "left_at", "done_on"])
          if (after(r[column])) {
            r[column] = null;
            if (column === "decided_at") Object.assign(r, { decision: "pending", refund_inr: null });
          }
    b.hackathon_members = b.hackathon_members.filter((m) => b.hackathon_teams.some((t) => t.team_id === m.team_id));
    return d;
  }

  it.each(dates)("at %s every figure is the same as if the later records did not exist", (day) => {
    const cut = truncated(day);
    // a table with no rows yet reads as "not applicable"; compare only where both datasets have it
    for (const t of Object.keys(cut.bets!) as (keyof NonNullable<Dataset["bets"]>)[]) if (!cut.bets![t].length && data.bets![t].length) cut.bets![t] = [{ ...data.bets![t][0], _deleted: true }];
    expect(snapshotAt(data, day)).toBe(snapshotAt(cut, day));
  });

  it("does not count a booking made after the selected date", () => {
    const booked = (day: string) => programView(data, `2025-${day}`).value.venues[0].sessions.find((s) => s.event_id === "E001")!.booking!.booked;
    expect([booked("04-02"), booked("04-04"), booked("04-06"), booked("04-08")]).toEqual([0, 3, 2, 3]);
  });

  it("keeps later records out of the copilot's view", () => {
    const view = viewAsOf(data, "2025-04-01").bets!;
    expect(view.passes.find((p) => p.pass_id === "PS-P10")!.qr_voided_at).toBeNull();
    expect(view.insurance_claims[0]).toMatchObject({ decision: "pending", refund_inr: null });
    expect(view.seat_booking_history).toEqual([]);
    expect(JSON.stringify(view.payments)).not.toContain("squad_cashback");
  });

  it("leaves an offer claimed later as still open", () => {
    const later = p5Fixture();
    later.bets!.exchange_offers[3].claimed_at = at("04-10");
    expect(k("K15", "04-07", later).value).toBe(50);
    expect(programView(later, "2025-04-07").value.venues[0].sessions.find((s) => s.event_id === "E001")!.booking).toMatchObject({ offersClaimed: 3, offersExpired: 1, offersOpen: 1 });
  });
});

describe("campus map", () => {
  const venue = (day: string) => programView(data, `2025-${day}`).value.venues[0];
  it("shows attendance only once a session has started", () => {
    expect(venue("04-11").sessions.find((s) => s.event_id === "E001")!.booking!.attended).toBeNull();
    expect(venue("04-12").sessions.find((s) => s.event_id === "E001")!.booking).toMatchObject({ attended: 2, turnaways: 1, waiting: 1 });
  });
  it("fills each day from that day's bookable sessions", () => {
    expect(venue("04-20").fillByDay).toEqual({ "2025-04-12": { seats: 4, booked: 3, fill: 75 }, "2025-04-13": { seats: 2, booked: 1, fill: 50 } });
  });
  it("keeps a venue with no sessions", () => {
    expect(programView(data, "2025-04-20").value.venues[1]).toMatchObject({ name: "Empty Court", capacity: null, sessions: [], fillByDay: {} });
  });
});

describe("Championship", () => {
  it("splits the occupied places among tied teams", () => {
    expect(tiePoints(100, 3, 3)).toBeCloseTo((40 + 20 + 10) / 3, 10);
    expect(tiePoints(100, 5, 2)).toBe(5); // 5th and an unpaid 6th
    expect(tiePoints(60, 1, 2)).toBe(48);
  });
  it("totals points by college and awards the Contingent Trophy on verified attendees", () => {
    const v = championship(data, "2025-04-20").value;
    expect(v.standings.map((s) => [s.college_id, s.rank, s.points, s.verified, s.tier])).toEqual([["COL1", 1, 123.33, 2, 50], ["COL2", 2, 83.33, 0, 0], ["COL3", 3, 23.33, 0, 0]]);
    expect(v.trophy).toEqual({ verified: 2, colleges: [{ college_id: "COL1", name: "Alpha College" }] });
    expect(v.mismatches).toEqual([]);
  });
  it("lists a recorded score that breaks the rules", () => {
    const wrong = p5Fixture();
    wrong.bets!.competition_results[2].points = 40;
    expect(championship(wrong, "2025-04-20").value.mismatches).toHaveLength(1);
  });
  it("has no results or trophy before they are recorded", () => {
    const v = championship(data, "2025-04-11").value;
    expect(v.resultsCount).toBe(0);
    expect(v.trophy).toBeNull();
    expect(v.standings.every((s) => s.verified === null)).toBe(true);
  });
});

describe("the original dataset", () => {
  const original: Dataset = { ...loadSeed(), program: shippedProgram as never };
  const all = (day: string) => {
    const v = betTracker(original, day).value;
    return Object.fromEntries([v.plan, ...v.bets].flatMap((c) => c.kpis).map((r) => [r.id, r]));
  };
  it("answers only attendees, the projection, channel efficiency and two proxies", () => {
    const rows = all("2025-04-20");
    expect(rows.K01.value).toBe(2050);
    expect(rows.K05).toMatchObject({ proxy: true, verdict: "tracking" });
    expect(rows.K05.value).toBeCloseTo(85.6, 1);
    expect(rows.K14.proxy).toBe(true);
    expect(rows.K20.display).toContain("2,050 actual");
    expect(Object.values(rows).filter((r) => r.verdict !== "not_applicable").map((r) => r.id).sort()).toEqual(["K01", "K05", "K14", "K20", "K21"]);
  });
  it("is too early for attendance before the fest", () => {
    expect(all("2025-03-15").K01).toMatchObject({ verdict: "too_early", value: null });
    expect(all("2025-03-15").K14.verdict).toBe("too_early");
  });
  it("shows the program without booking data, and no Championship", () => {
    const v = programView(original, "2025-04-20").value;
    expect([v.hasBookings, v.venues.length, v.venues.flatMap((x) => x.sessions).length]).toEqual([false, 24, 69]);
    expect(v.venues.flatMap((x) => x.sessions).every((s) => s.booking === null)).toBe(true);
    expect(championship(original, "2025-04-20").value.available).toBe(false);
  });
  it("has a venue on the map for every venue in the program", async () => {
    const svg = (await import("node:fs")).readFileSync("public/campus_map.svg", "utf8");
    for (const v of shippedProgram.venues) {
      expect(svg).toContain(`id="${v.venue_id}"`);
      expect(svg).toContain(`data-venue="${v.venue_id}"`);
    }
  });
});

describe("direct links", () => {
  it("only point at the allowed screens", () => {
    expect([hrefFor("venue", "VEN06"), hrefFor("event", "E001"), hrefFor("bet", "B1"), hrefFor("college", "COL1")]).toEqual(["/map?focus=VEN06", "/map?focus=E001", "/bets?focus=B1", "/championship?focus=COL1"]);
    expect(hrefFor("bet", "../x")).toBe("/bets");
  });
});
