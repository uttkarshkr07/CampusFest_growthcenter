import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadSeed } from "./seed";
import * as E from "@/lib/engine";
import { historyContents, runTurn, type TurnInput } from "@/lib/copilot/loop";
import { buildDeclarations } from "@/lib/copilot/tool-defs";
import { classifyError, geminiRequest, parseBody } from "@/lib/copilot/gemini";
import { SYSTEM_RULES } from "@/lib/copilot/prompt";
import { unverifiedNumbers } from "@/lib/copilot/numcheck";
import { hrefFor } from "@/lib/copilot/targets";
import { ModelError, type ChatMessage, type ModelReply, type ModelRequest, type Part } from "@/lib/copilot/types";

const POST = "2025-04-20";
const MAR15 = "2025-03-15";
const declFile = path.resolve(__dirname, "../lib/copilot/declarations.json");
const data = loadSeed();

const say = (text: string): Part => ({ text });
const call = (name: string, args: Record<string, unknown> = {}, signature?: string): Part => ({ functionCall: { name, args }, ...(signature ? { thoughtSignature: signature } : {}) });

type Step = Part[] | ModelError;
function fakeModel(steps: Step[]) {
  const seen: ModelRequest[] = [];
  const callModel = async (req: ModelRequest): Promise<ModelReply> => {
    seen.push(structuredClone(req));
    const step = steps[seen.length - 1];
    if (!step) throw new Error("unexpected extra model request");
    if (step instanceof ModelError) throw step;
    return { parts: step, model: `fake-${req.modelIndex}` };
  };
  return { callModel, seen };
}

function turn(steps: Step[], patch: Partial<TurnInput> = {}) {
  const fake = fakeModel(steps);
  let n = 0;
  const selectedDate = patch.selectedDate ?? POST;
  const run = runTurn({
    question: "How are we doing?",
    selectedDate,
    summary: E.buildSummary(data, selectedDate),
    context: {},
    history: [],
    callModel: fake.callModel,
    runTool: (name, args) => E.executeToolAsOf(data, name, args, selectedDate),
    sleep: async () => {},
    newId: () => `id${++n}`,
    ...patch,
  });
  return { run, seen: fake.seen };
}

describe("tool declarations", () => {
  it("match the committed file", () => {
    const built = JSON.stringify(buildDeclarations(), null, 1) + "\n";
    if (process.env.UPDATE_DECLARATIONS) writeFileSync(declFile, built);
    expect(readFileSync(declFile, "utf8").replace(/\r\n/g, "\n")).toBe(built);
  });
  it("use only the schema keywords Gemini accepts and never require asOf", () => {
    const text = JSON.stringify(buildDeclarations());
    expect(text).not.toMatch(/\$schema|additionalProperties|exclusiveMinimum|"pattern"|anyOf/);
    for (const d of buildDeclarations()) expect(((d.parameters?.required as string[]) ?? [])).not.toContain("asOf");
  });
  it("carry no dataset findings in the rules or tool descriptions", () => {
    const text = SYSTEM_RULES + JSON.stringify(buildDeclarations());
    expect(text).not.toMatch(/2025|Beardo|Paid Social|College Partnerships|2,050|2050/);
  });
});

describe("loop", () => {
  it("answers from the summary with a single request", async () => {
    const { run, seen } = turn([[say("**Answer**\nWe had 2,050 actual attendees.")]]);
    const m = await run;
    expect(seen.length).toBe(1);
    expect(m.requests).toBe(1);
    expect(m.unverified).toEqual([]);
    expect(seen[0].contents[0].parts[0].text).toMatch(/^SUMMARY/);
  });

  it("runs tools and returns the model's parts unchanged, signatures included", async () => {
    const first = [call("query", { dataset: "people", filters: [{ field: "days_attended", op: "eq", values: ["2"] }], measures: ["people"] }, "sig-1"), call("actionList", { cohort: "waitlisted" })];
    const { run, seen } = turn([first, [say("725 people came both days; 88 were waitlisted.")]]);
    const m = await run;
    expect(m.tools!.map((t) => t.name)).toEqual(["query", "actionList"]);
    expect(m.unverified).toEqual([]);
    const second = seen[1].contents;
    expect(second[second.length - 2]).toEqual({ role: "model", parts: first });
    const responses = second[second.length - 1].parts;
    expect(responses.map((p) => p.functionResponse!.name)).toEqual(["query", "actionList"]);
  });

  it("caps a later date requested by the model", async () => {
    const { run } = turn([[call("funnel", { asOf: POST })], [say("Nothing has happened yet.")]], { selectedDate: MAR15 });
    const m = await run;
    expect(m.tools![0].asOfUsed).toBe(MAR15);
    expect(m.tools![0].caveats[0]).toMatch(/Later data/);
  });

  it("reports a tool error back to the model instead of failing", async () => {
    const { run, seen } = turn([[call("noSuchTool")], [say("I can't look that up.")]]);
    const m = await run;
    expect(m.tools![0].ok).toBe(false);
    expect(JSON.stringify(seen[1].contents.at(-1))).toMatch(/Unknown tool/);
  });

  it("forces an answer on the last request and says when it is incomplete", async () => {
    const { run, seen } = turn([[call("funnel")], [call("flags")], [call("pace")]]);
    const m = await run;
    expect(seen.map((r) => r.finalRound)).toEqual([false, false, true]);
    expect(m.text).toMatch(/lookup limit/);
  });

  it("ends the turn at a task draft when the model also wrote an answer", async () => {
    const { run, seen } = turn([[say("Here is a task."), call("proposeTask", { title: "Call waitlist", description: "d", reason: "r", evidence: ["88"], dueDate: "2025-04-23", priority: "urgent" })]]);
    const m = await run;
    expect(seen.length).toBe(1);
    const action = m.actions![0];
    expect(action.type === "task" && action.status).toBe("proposed");
    expect(action.type === "task" && action.proposal.priority).toBe("medium");
  });

  it("checks the figures inside a task draft too", async () => {
    const { run } = turn([[say("Draft below."), call("proposeTask", { title: "Call people", description: "d", reason: "r", evidence: ["4321 people are waiting"] })]]);
    expect((await run).unverified).toEqual(["4321"]);
  });

  it("builds buttons only from known targets", async () => {
    const { run } = turn([[say("I can't edit campaigns."), call("openInApp", { target: "campaign", id: "C02", label: "Open campaign" }), call("openInApp", { target: "https://evil.example", label: "x" })]]);
    const m = await run;
    expect(m.actions).toEqual([{ type: "link", id: "id1", label: "Open campaign", href: "/campaigns?focus=C02" }]);
    expect(hrefFor("campaign", "../../x")).toBe("/campaigns");
  });

  it("waits once on a per-minute limit", async () => {
    const { run, seen } = turn([new ModelError("rate", "slow", 5), [say("ok")]]);
    expect((await run).text).toBe("ok");
    expect(seen.length).toBe(2);
  });

  it("restarts the whole turn on the backup model", async () => {
    const { run, seen } = turn([[call("funnel")], new ModelError("quota_day", "used up", null, true), [say("from backup")]]);
    const m = await run;
    expect(m.model).toBe("fake-1");
    expect(seen[2].modelIndex).toBe(1);
    expect(seen[2].contents.length).toBe(1); // no half-finished tool turn is carried across models
    expect(m.tools).toEqual([]);
  });

  it("fails plainly when there is no backup", async () => {
    await expect(turn([new ModelError("quota_day", "used up")]).run).rejects.toThrow("used up");
  });
});

describe("history", () => {
  const msg = (role: "user" | "assistant", text: string, asOf: string): ChatMessage => ({ id: text, role, text, asOf, createdAt: "" });
  const history = [msg("user", "early question", MAR15), msg("assistant", "early answer", MAR15), msg("user", "why is the final number low?", POST), msg("assistant", "final results say X", POST)];

  it("drops turns written at a later date than the one selected", () => {
    const text = JSON.stringify(historyContents(history, MAR15));
    expect(text).toContain("early answer");
    expect(text).not.toContain("final");
  });
  it("keeps them again at a later date", () => expect(historyContents(history, POST).length).toBe(4));
});

describe("number check", () => {
  const sources = [{ spend: 274000, pct: 93.2, rate: 0.75 }, "INR 2,74,000 and 575 people"];
  it("accepts source figures in other formats", () => {
    expect(unverifiedNumbers("Spend was INR 2,74,000 (2.74 lakh), 93% of goal, 75% mid case, 575 people on 15 Mar 2025 for C02.", sources)).toEqual([]);
  });
  it("flags invented figures", () => {
    expect(unverifiedNumbers("This would add 412 attendees, a 38% lift.", sources)).toEqual(["412", "38"]);
  });
});

describe("proxy helpers", () => {
  it("validates the body", () => {
    expect(parseBody("nope")).toMatch(/JSON/);
    expect(parseBody(JSON.stringify({ contents: [{ role: "system", parts: [] }] }))).toMatch(/invalid/);
    expect(parseBody("x".repeat(200000))).toMatch(/large/);
    expect(typeof parseBody(JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }))).toBe("object");
  });
  it("fixes rules and tools on the server and turns tools off on the last request", () => {
    const body = geminiRequest({ contents: [], finalRound: true, modelIndex: 0 });
    expect(body.toolConfig.functionCallingConfig.mode).toBe("NONE");
    expect(body.tools[0].functionDeclarations.length).toBeGreaterThan(10);
  });
  it("tells a daily limit apart from a per-minute one", () => {
    const quota = (id: string) => ({ error: { details: [{ violations: [{ quotaId: id }] }, { retryDelay: "21s" }] } });
    expect(classifyError(429, quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")).kind).toBe("quota_day");
    const minute = classifyError(429, quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"));
    expect([minute.kind, minute.retryAfterSec]).toEqual(["rate", 21]);
    expect(classifyError(404, null).kind).toBe("unavailable");
  });
});
