// P7: the copilot's bet, booking, Championship and money tools on both datasets, the summary's bet block,
// and the dataset line every answer starts with.
import { describe, expect, it } from "vitest";
import { loadSeed } from "./seed";
import { p5Fixture } from "./p5_fixture";
import * as E from "@/lib/engine";
import { NO_BET_RECORDS } from "@/lib/engine/copilot_bets";
import { runTurn } from "@/lib/copilot/loop";
import { MODEL_TOOLS } from "@/lib/copilot/tool-defs";
import { ANSWER_LABEL } from "@/lib/datasets";
import type { ModelReply } from "@/lib/copilot/types";

const POST = "2025-04-20";
const MAR15 = "2025-03-15";
const TOOLS = ["betStatus", "bookings", "championship", "payments"] as const;
const LIMIT = 14000; // the loop cuts tool results above this

const seed = loadSeed();
const sim = p5Fixture();
const run = (d: E.Dataset, name: string, args: Record<string, unknown> = {}, date = POST) => {
  const out = E.executeToolAsOf(d, name, args, date);
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return out.result as { value: Record<string, unknown>; basis: string[]; caveats: string[] };
};

describe("new copilot tools", () => {
  it("are offered to the model", () => {
    for (const t of TOOLS) expect(MODEL_TOOLS).toContain(t);
  });

  it("say on the original data that the records do not exist, with no bet figure", () => {
    for (const t of TOOLS) {
      const r = run(seed, t);
      expect(r.caveats.join(" ")).toContain("do not exist here");
      expect(r.value.dataset).toBe("original");
    }
    expect(run(seed, "championship").value.standings).toEqual([]);
    expect(run(seed, "payments").value.available).toBe(false);
    const b = run(seed, "bookings").value;
    expect(b.hasBookings).toBe(false);
    expect(b.soldOut).toBeNull();
    // the program (the plan) is still listed when the app has loaded one; the test seed has none
    const withProgram = { ...seed, program: { venues: sim.bets!.venues, program_events: sim.bets!.program_events } };
    const p = run(withProgram, "bookings").value;
    expect((p.venues as unknown[]).length).toBeGreaterThan(0);
    expect(p.hasBookings).toBe(false);
    expect((p.sessions as { booked?: number }[]).every((s) => s.booked === undefined)).toBe(true);
  });

  it("read the simulated records", () => {
    const bets = run(sim, "betStatus").value;
    expect(bets.dataset).toBe("simulated");
    expect((bets.bets as unknown[]).length).toBe(6);
    const one = run(sim, "betStatus", { kpiId: "K13" }).value.kpi as Record<string, unknown>;
    expect(one.id).toBe("K13");
    expect(one).toHaveProperty("threshold");

    const champ = run(sim, "championship").value;
    expect(champ.available).toBe(true);
    expect((champ.standings as unknown[]).length).toBeGreaterThan(0);

    const money = run(sim, "payments").value as { examClashClaims: { approved: number; approvedRefundsInr: number }; paymentsByKind: Record<string, unknown> };
    expect(money.examClashClaims.approved).toBe(1);
    expect(money.examClashClaims.approvedRefundsInr).toBe(401);
    expect(Object.keys(money.paymentsByKind).length).toBeGreaterThan(0);
  });

  it("never show a claim decided after the selected date", () => {
    const before = run(sim, "payments", {}, "2025-04-02").value as { examClashClaims: { approved: number; pending: number; filed: number } };
    expect(before.examClashClaims).toMatchObject({ filed: 1, approved: 0, pending: 1 });
    // a later date asked for is pulled back to the selected one
    const capped = E.executeToolAsOf(sim, "payments", { asOf: POST }, "2025-04-02");
    expect((capped.result as { caveats: string[] }).caveats[0]).toMatch(/Later data is not available/);
    expect(((capped.result as { value: { examClashClaims: { approved: number } } }).value).examClashClaims.approved).toBe(0);
  });

  it("stay under the result size the loop allows", () => {
    for (const d of [seed, sim]) for (const t of TOOLS) for (const date of [MAR15, POST]) expect(JSON.stringify(E.executeToolAsOf(d, t, {}, date).result).length).toBeLessThan(LIMIT);
  });

  it("reject an unknown KPI without throwing", () => {
    expect(String(run(sim, "betStatus", { kpiId: "K99" }).value.error)).toMatch(/Unknown KPI/);
  });
});

describe("summary", () => {
  it("names the dataset and carries a bet block only on the simulated data", () => {
    const o = E.buildSummary(seed, POST);
    expect(o.dataset).toBe("original");
    expect(o.bets).toBeNull();
    expect(o.betRecords).toBe(NO_BET_RECORDS);
    const s = E.buildSummary(sim, POST);
    expect(s.dataset).toBe("simulated");
    expect(s.bets!.rows.map((r) => r[0])).toEqual(["B1", "B2", "B3", "B4", "B5", "PLAN"]);
    expect(typeof s.betRecords).toBe("object");
  });
  it("does not leak later bet rows", () => {
    const s = E.buildSummary(sim, "2025-02-01");
    expect((s.betRecords as Record<string, number>).insurance_claims).toBe(0);
  });
});

describe("championship before any result", () => {
  it("ranks nobody and says no leader exists", () => {
    const v = run(sim, "championship", {}, "2025-02-01");
    expect(v.value.standings).toEqual([]);
    expect(v.caveats[0]).toMatch(/no ranking and no leader/);
  });
});

describe("dataset line", () => {
  let text = "**Answer**\nAll good.";
  const reply = async (): Promise<ModelReply> => ({ parts: [{ text }], model: "fake" });
  const turn = (label?: string) =>
    runTurn({ question: "q", selectedDate: POST, summary: {}, context: {}, history: [], datasetLabel: label, callModel: reply, runTool: () => ({ ok: true, asOfUsed: POST }), newId: () => "x" });
  it("drops a made-up link but keeps real ones", async () => {
    text = "Use [Open settings](DUMMY) or [Open](https://) or [the map](/map) or [docs](https://example.com).";
    expect((await turn()).text).toBe("Use Open settings or Open or [the map](/map) or [docs](https://example.com).");
    text = "**Answer**\nAll good.";
  });
  it("starts every answer with the dataset name", async () => {
    expect((await turn(ANSWER_LABEL.original)).text.startsWith("*Data: Original 2025 data*")).toBe(true);
    expect((await turn(ANSWER_LABEL.simulated)).text).toMatch(/^\*Data: SIMULATED/);
    expect((await turn()).text).toBe("**Answer**\nAll good.");
  });
});
