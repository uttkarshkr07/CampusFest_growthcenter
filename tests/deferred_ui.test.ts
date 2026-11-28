import { describe, expect, it } from "vitest";
import { loadSeed } from "./seed";
import * as E from "@/lib/engine";
import type { TaskRow } from "@/lib/engine/types";

const POST = "2025-04-20";
const PRE = "2025-03-15";

describe("funnel for one campaign", () => {
  const d = loadSeed();
  const stage = (f: ReturnType<typeof E.funnel>["value"], k: string) => f.stages.find((s) => s.key === k)?.count;

  it("C04 College Partnerships: 450 registered, 385 attended (handoff section 4)", () => {
    const f = E.funnel(d, POST, { campaignId: "C04" }).value;
    expect(stage(f, "registered")).toBe(450);
    expect(stage(f, "attended")).toBe(385);
    expect(f.walkIns).toBe(0);
  });

  for (const asOf of [PRE, POST])
    it(`every campaign matches its campaignTable row (${asOf})`, () => {
      const rows = E.campaignTable(d, asOf).value.rows;
      for (const r of rows) {
        const f = E.funnel(d, asOf, { campaignId: r.campaign_id }).value;
        expect(stage(f, "identified")).toBe(r.identified);
        expect(stage(f, "registered")).toBe(r.registered);
        expect(stage(f, "confirmed")).toBe(r.confirmed);
        if (r.attended != null) expect(stage(f, "attended")).toBe(r.attended);
      }
    });

  it("without a campaign the whole funnel is unchanged", () => {
    const f = E.funnel(d, POST).value;
    expect(stage(f, "registered")).toBe(2800);
    expect(f.actualAttendees).toBe(2050);
  });
});

describe("people filters", () => {
  const d = loadSeed();
  it("external + attended = 2,050 actual attendees", () => {
    expect(E.peopleDirectory(d, POST, { personType: "external", attended: "yes" }).value.total).toBe(2050);
  });
  it("registration campaign C04 = 450 external registrants", () => {
    expect(E.peopleDirectory(d, POST, { personType: "external", campaignId: "C04" }).value.total).toBe(450);
  });
  it("filters apply before paging", () => {
    const r = E.peopleDirectory(d, POST, { attended: "yes", page: 3, pageSize: 50 }).value;
    expect(r.rows.length).toBe(50);
    expect(r.rows.every((x) => x.attended)).toBe(true);
  });
  it("not registered = no registration campaign and no status", () => {
    const a = E.peopleDirectory(d, POST, { campaignId: "none" }).value.total;
    const b = E.peopleDirectory(d, POST, { status: "none" }).value.total;
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });
});

describe("task filter by team", () => {
  const d = loadSeed();
  const team = [
    { owner_id: "T03", owner_name: "Meera Iyer", team: "publicity" },
    { owner_id: "T06", owner_name: "Dev Malhotra", team: "events" },
  ] as unknown as typeof d.team;
  const [owner, other] = team;
  const task = (id: string, owner_id: string | null) => ({ id, title: id, status: "todo", owner_id, campaign_id: null, due_at: null, priority: "medium", origin: "manual" }) as unknown as TaskRow;
  const data = { ...d, team, tasks: [task("a", owner.owner_id), task("b", other.owner_id), task("c", null)] };
  it("keeps only tasks whose owner is in that team", () => {
    expect(E.tasksView(data, POST, { team: owner.team! }).value.rows.map((r) => r.id)).toEqual(["a"]);
    expect(E.tasksView(data, POST, {}).value.rows.length).toBe(3);
  });
});

describe("bet operating spend counts as its campaign's cost", () => {
  const d = loadSeed();
  const c08 = { ...d.campaigns[0], campaign_id: "C08", campaign_name: "College Contingents", created_at: "2025-01-15T09:00:00+05:30" };
  const spend = (spend_id: string, bet_id: string, spent_on: string, amount_inr: number, extra = {}) => ({ spend_id, bet_id, spent_on, amount_inr, item: "x", ...extra });
  const bets = {
    bet_spend: [
      spend("S1", "B1", "2025-02-01", 1000),
      spend("S2", "B1", "2025-04-30", 500), // after as-of
      spend("S3", "B2", "2025-02-01", 9000), // not tied to one campaign
      spend("S4", "B1", "2025-02-02", 200),
      spend("S4", "B1", "2025-02-02", 300), // same id: last row wins
      spend("S5", "B1", "2025-02-03", 700, { _deleted: true }),
    ],
  };
  const data = { ...d, campaigns: [...d.campaigns, c08], bets: bets as unknown as NonNullable<typeof d.bets> };

  it("sums only the mapped bet, up to as-of, deduped, not deleted", () => {
    expect(E.betSpendAsOf(data, Date.parse("2025-04-20T23:59:59+05:30"), "C08")).toBe(1300);
    expect(E.betSpendAsOf(data, Date.parse("2025-04-20T23:59:59+05:30"), "C04")).toBe(0);
  });

  it("cost and blended figures include it; marketing spend does not", () => {
    const base = E.campaignTable(d, POST).value;
    const t = E.campaignTable(data, POST).value;
    const row = t.rows.find((r) => r.campaign_id === "C08")!;
    expect(row.spend).toBe(0);
    expect(row.betSpend).toBe(1300);
    expect(row.cost).toBe(1300);
    expect(t.totals.spend).toBe(base.totals.spend);
    expect(t.totals.cost).toBe(base.totals.spend + 1300);
    expect(t.totals.blendedInrPerAttendee).toBe(Math.round((base.totals.spend + 1300) / t.totals.attended!));
  });

  it("the original data has no bet spend, so nothing moves", () => {
    const t = E.campaignTable(d, POST).value;
    expect(t.totals.betSpend).toBe(0);
    expect(t.rows.find((r) => r.campaign_id === "C04")!.inrPerAttendee).toBe(81);
  });
});
