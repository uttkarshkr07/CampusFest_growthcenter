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
