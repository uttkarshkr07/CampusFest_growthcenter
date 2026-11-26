import { describe, expect, it } from "vitest";
import { loadSeed } from "./seed";
import * as E from "@/lib/engine";

const POST = "2025-04-20";
const MAR15 = "2025-03-15";

describe("query", () => {
  const d = loadSeed();
  const q = (spec: Omit<E.QuerySpec, "asOf">, asOf = POST) => E.query(d, { asOf, ...spec });

  it("agrees with the funnel on attendees and walk-ins", () => {
    const v = q({ dataset: "people", measures: ["attended", "walk_ins", "registered"] }).value!;
    expect(v.totals).toEqual({ attended: 2050, walk_ins: 125, registered: 2800 });
  });
  it("counts people who came on both days", () => {
    const v = q({ dataset: "people", filters: [{ field: "days_attended", op: "eq", values: ["2"] }], measures: ["people"] }).value!;
    expect(v.totals.people).toBe(725);
  });
  it("splits admissions by day", () => {
    const v = q({ dataset: "scans", filters: [{ field: "counts_as_attendance", op: "eq", values: ["true"] }], groupBy: ["day"], measures: ["scans", "distinct_people"] }).value!;
    expect(v.groups.map((g) => g.day)).toEqual(["2025-04-12", "2025-04-13"]);
    expect(v.totals.distinct_people).toBe(2050);
    expect(v.totals.scans).toBe(3250);
  });
  it("matches the campaign table when grouped by campaign", () => {
    const v = q({ dataset: "people", filters: [{ field: "registered", op: "eq", values: ["true"] }], groupBy: ["campaign_id"], measures: ["registered", "show_up_pct"] }).value!;
    const table = E.campaignTable(d, POST).value.rows;
    for (const g of v.groups) {
      const row = table.find((r) => r.campaign_id === g.campaign_id)!;
      expect(g.registered).toBe(row.registered);
      expect(g.show_up_pct).toBe(row.showUpPct);
    }
  });
  it("matches ledger spend", () => expect(q({ dataset: "daily_marketing", measures: ["spend"] }).value!.totals.spend).toBe(274000));
  it("says it cannot answer for unknown fields", () => {
    const r = q({ dataset: "people", groupBy: ["reason_for_not_attending"] });
    expect(r.value).toBeNull();
    expect(r.caveats[0]).toMatch(/cannot answer/);
  });
  it("refuses attendance before the event", () => {
    const r = q({ dataset: "people", measures: ["attended"] }, MAR15);
    expect(r.value).toBeNull();
    expect(r.caveats[0]).toMatch(/not happened/);
  });
});

describe("actionList", () => {
  const d = loadSeed();
  const group = (asOf: string, cohort: E.Cohort) => E.actionList(d, asOf, cohort).value.groups[0];

  it("waitlisted: 88 and none attended", () => {
    const g = group(POST, "waitlisted");
    expect(g.count).toBe(88);
    expect(g.laterAttended).toBe(0);
  });
  it("gate failures include the 60 confirmed no-shows who reached the gate", () => {
    const failed = E.actionMembers(d, POST, "gate_failed_not_admitted");
    expect(failed.filter((m) => m.status === "confirmed").length).toBe(60);
    expect(failed.every((m) => m.attended === false)).toBe(true);
  });
  it("has no gate or outcome information before the event", () => {
    expect(group(MAR15, "gate_failed_not_admitted").count).toBe(0);
    const g = group(MAR15, "confirmed_not_engaged");
    expect(g.laterAttended).toBeNull();
    expect(E.actionMembers(d, MAR15, "confirmed_not_engaged").every((m) => m.attended === null)).toBe(true);
    expect(E.actionList(d, MAR15, "confirmed_not_engaged").caveats.join(" ")).toMatch(/NOT yet known/);
  });
});

describe("whatIf", () => {
  const d = loadSeed();
  const moves = [
    { from: "C02", inr: 53000 }, { from: "C03", inr: 39000 },
    { to: "C04", inr: 40000 }, { to: "C05", inr: 25000 }, { to: "C07", inr: 15000 }, { to: "C01", inr: 12000 },
  ];
  it("reproduces the deck's reallocation arithmetic", () => {
    const v = E.whatIf(d, { asOf: POST, moves }).value!;
    expect(v.netBudgetChangeInr).toBe(0);
    expect(v.low.attendeeChange).toBeGreaterThanOrEqual(245);
    expect(v.low.attendeeChange).toBeLessThanOrEqual(260);
    expect(v.high.attendeeChange).toBeGreaterThan(v.low.attendeeChange);
    expect(v.low.attendees).toBe(2050 + v.low.attendeeChange);
  });
  it("cuts the costliest campaigns first when asked", () => {
    const v = E.whatIf(d, { asOf: POST, budgetChangePct: -30, cutStrategy: "costliest_first" }).value!;
    expect(v.lines[0].campaign_id).toBe("C03");
    expect(v.netBudgetChangeInr).toBe(-82200);
    expect(v.high.attendeeChange).toBeLessThan(0);
  });
  it("applies a show-up target", () => {
    const v = E.whatIf(d, { asOf: POST, confirmedShowUpPct: 87 }).value!;
    expect(v.showUp!.fromPct).toBe(77);
    expect(v.low.attendeeChange).toBe(250);
  });
  it("rejects taking more than a campaign has spent, and unknown campaigns", () => {
    expect(E.whatIf(d, { asOf: POST, moves: [{ from: "C07", inr: 999999 }] }).value).toBeNull();
    expect(E.whatIf(d, { asOf: POST, moves: [{ to: "C99", inr: 100 }] }).value).toBeNull();
  });
  it("warns before the event that channel attendance is unknown", () => {
    const r = E.whatIf(d, { asOf: MAR15, moves: [{ from: "C02", to: "C04", inr: 10000 }] });
    expect(r.value!.baseline.kind).toMatch(/projected/);
    expect(r.caveats.join(" ")).toMatch(/not known at this date/);
  });
});

describe("strict hindsight", () => {
  const d = loadSeed();
  const task = (id: string, asOf: string) => ({ id, title: `from ${asOf}`, description: null, campaign_id: null, owner_id: null, due_at: null, status: "todo" as const, priority: "low" as const, origin: "copilot" as const, origin_ref: { asOf }, created_at: "2026-11-27T00:00:00Z", updated_at: "2026-11-27T00:00:00Z" });
  d.tasks = [task("early", "2025-03-10"), task("late", POST)];
  d.change_log = [{ id: 1, table_name: "tasks", row_ref: "late", field: "(created)", old_value: null, new_value: { title: "secret later result" }, changed_at: "2026-11-27T00:00:00Z" }];
  const run = (name: string, args: unknown) => E.executeToolAsOf(d, name, args, MAR15);

  it("caps a later requested date and says so", () => {
    const out = run("funnel", { asOf: POST });
    expect(out.asOfUsed).toBe(MAR15);
    const res = (out as { result: { value: { phase: string; actualAttendees: number }; caveats: string[] } }).result;
    expect(res.value.phase).toBe("pre-event");
    expect(res.value.actualAttendees).toBe(0);
    expect(res.caveats[0]).toMatch(/Later data is not available/);
  });
  it("allows an earlier date", () => expect(run("funnel", { asOf: "2025-02-15" }).asOfUsed).toBe("2025-02-15"));
  it("fills in a missing date", () => expect(run("flags", {}).ok).toBe(true));
  it("hides target versions and tasks from later dates", () => {
    const before = E.executeToolAsOf(d, "eventInfo", {}, "2025-03-01") as { result: { value: { targets: unknown[] } } };
    expect(before.result.value.targets.length).toBe(1);
    const tasks = JSON.stringify(run("tasks", {}));
    expect(tasks).toContain("early");
    expect(tasks).not.toContain("from 2025-04-20");
    expect(JSON.stringify(run("momentum", {}))).not.toContain("secret later result");
  });
  it("removes later rows from the view entirely", () => {
    const v = E.viewAsOf(d, MAR15);
    expect(v.checkins.length).toBe(0);
    expect(v.daily_marketing.every((r) => r.activity_date <= MAR15)).toBe(true);
  });
  it("gives the same numbers as the unfiltered engine", () => {
    for (const day of [MAR15, "2025-04-12", POST]) {
      const v = E.viewAsOf(d, day);
      expect(E.funnel(v, day).value).toEqual(E.funnel(d, day).value);
      expect(E.campaignTable(v, day).value.rows).toEqual(E.campaignTable(d, day).value.rows);
    }
  });
  it("puts no post-event outcome in a pre-event summary", () => {
    const s = E.buildSummary(d, MAR15);
    expect(s.funnel.actualAttendees).toBe(0);
    expect(s.dataAvailable.checkins.rows).toBe(0);
    expect(s.campaigns.rows.every((r) => r[6] === null && r[7] === null && r[10] === null)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/2025 data|from 2025-04-20/);
  });
});

describe("changed data", () => {
  it("the summary follows an edit", () => {
    const d = loadSeed();
    const before = E.buildSummary(d, POST).campaigns.totals.spend;
    const edited = { ...d, daily_marketing: d.daily_marketing.map((r, i) => (i === 0 ? { ...r, marketing_spend_inr: Number(r.marketing_spend_inr ?? 0) + 5000 } : r)) };
    expect(E.buildSummary(edited, POST).campaigns.totals.spend).toBeGreaterThan(before);
  });
  it("reports summary size", () => {
    const size = JSON.stringify(E.buildSummary(loadSeed(), POST)).length;
    console.log(`summary: ${size} chars, roughly ${Math.round(size / 4)} tokens`);
    expect(size).toBeLessThan(16000);
  });
});
