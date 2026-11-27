// The app asks the database for the right dataset: every load, change, ticket, reset and chat.
// The database is a stand-in that records what was asked; tests/db_isolation.test.ts covers the SQL.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseChatStorage } from "@/lib/copilot/storage-db";
import { PAGED_BET_TABLES } from "@/lib/data/bet-spec";
import { PAGED_TABLES } from "@/lib/data/decode";
import { viewAsOf } from "@/lib/engine/view";
import { rpcName, stagingName, tableName } from "@/lib/datasets";
import { useSponsor } from "@/lib/sponsor/store";
import { useStore } from "@/lib/store";
import { loadSeed } from "./seed";

type Reply = { data: unknown; error: { message: string } | null };
const fake = vi.hoisted(() => ({
  calls: [] as string[],
  /** what sim_dataset_status answers */
  status: { data: true as unknown, error: null as { message: string } | null },
  /** a load waits on this when set */
  hold: null as Promise<void> | null,
}));

/** every method returns itself; awaiting it answers */
function query(label: string, answer: () => Reply) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "order", "limit", "single"]) q[m] = () => q;
  q.eq = (column: string, value: unknown) => {
    if (column === "dataset") fake.calls.push(`${label} where dataset=${value}`);
    return q;
  };
  q.then = (ok: (r: Reply) => unknown) => Promise.resolve(answer()).then(ok);
  return q;
}
const range = [0, -1, 0];
const appData = () => ({
  versions: {},
  ranges: Object.fromEntries([...PAGED_TABLES, ...PAGED_BET_TABLES].map((t) => [t, range])),
  tables: { event: [{ history_start: "2025-01-15", history_end: "2025-04-20", event_starts_at: "2025-04-12T10:00:00+05:30" }], targets: [], campaigns: [], sponsor_activations: [], campaign_plan: [], team: [], tasks: [], settings: [], change_log: [], tickets: [], ticket_events: [] },
  bets: { squads: [] },
});
const db = {
  from: (name: string) => {
    fake.calls.push(`from ${name}`);
    return Object.assign(query(`from ${name}`, () => ({ data: name.endsWith("sponsor_data") || name === "chat_sessions" ? [] : { id: "x", campaign_id: "C01", _row_id: 1 }, error: null })), {
      insert: (row: Record<string, unknown>) => {
        if ("dataset" in row) fake.calls.push(`insert ${name} dataset=${row.dataset}`);
        return query(`from ${name}`, () => ({ data: { id: "x" }, error: null }));
      },
    });
  },
  rpc: (name: string) => {
    fake.calls.push(`rpc ${name}`);
    if (name === "sim_dataset_status") return Promise.resolve(fake.status);
    const hold = name.endsWith("get_app_data") ? fake.hold : null;
    const reply = { data: name.endsWith("get_app_data") ? appData() : "id", error: null };
    return Object.assign(query(name, () => reply), { then: (ok: (r: Reply) => unknown) => (hold ?? Promise.resolve()).then(() => reply).then(ok) });
  },
};
vi.mock("@/lib/supabase", () => ({ getSupabase: () => db }));

const asked = () => fake.calls.splice(0);
const store = () => useStore.getState();

beforeEach(async () => {
  fake.status = { data: true, error: null };
  fake.hold = null;
  store().clear();
  useStore.setState({ dataset: "original", saving: false });
  await store().load();
  asked();
});

async function changeEverything() {
  useStore.setState({ data: { ...store().data!, checkins: [{ _row_id: 1 } as never] } });
  await store().updateSourceRow("checkins", 1, { result: "denied" }, "CHK1");
  await store().insertSourceRow("targets", {}, "v2");
  await store().upsertPlan("C01", { app_status: "paused" });
  await store().setSetting("min_sample", 40);
  await store().createTask({ title: "t" } as never);
  await store().updateTask("x", { title: "u" });
  await store().deleteTask("x");
  await store().raiseTicket({ title: "t", details: "", priority: "low", neededBy: null, fromTeam: "events", toTeam: "publicity", assigneeId: null });
  await store().moveTicket("x", "accepted", null);
  await store().commentTicket("x", "hello");
  await store().editTicket("x", { title: "t", details: "", priority: "low", neededBy: null });
  await store().resetDemo();
}

describe("names", () => {
  it("prefix only the simulated dataset", () => {
    expect([tableName("original", "people"), tableName("simulated", "people"), rpcName("simulated", "reset_demo"), stagingName("simulated", "people")]).toEqual(["people", "sim_people", "sim_reset_demo", "sim_original_people"]);
  });
});

describe("the store", () => {
  it("on the original, never touches a simulated table or function", async () => {
    await changeEverything();
    const calls = asked().filter((c) => c !== "rpc sim_dataset_status");
    expect(calls.filter((c) => c.includes("sim_"))).toEqual([]);
    for (const c of ["from checkins", "from targets", "from campaign_plan", "from settings", "from tasks", "from change_log", "rpc raise_ticket", "rpc move_ticket", "rpc comment_ticket", "rpc edit_ticket", "rpc reset_demo", "rpc get_app_data"]) expect(calls).toContain(c);
  });

  it("on the simulated data, uses only sim_ tables and functions", async () => {
    store().setDataset("simulated");
    expect(store()).toMatchObject({ dataset: "simulated", data: null, status: "idle" });
    await store().load();
    expect(store().data!.bets).toBeDefined();
    asked();
    await changeEverything();
    const calls = asked();
    expect(calls.filter((c) => !/^(from|rpc) sim_/.test(c))).toEqual([]);
    for (const c of ["from sim_checkins", "from sim_tasks", "from sim_change_log", "from sim_settings", "from sim_campaign_plan", "from sim_tickets", "rpc sim_raise_ticket", "rpc sim_move_ticket", "rpc sim_comment_ticket", "rpc sim_edit_ticket", "rpc sim_reset_demo", "rpc sim_get_app_data"]) expect(calls).toContain(c);
  });

  it("keeps the selected date when switching, and reads that dataset's sponsor records", async () => {
    store().setAsOf("2025-03-15");
    await useSponsor.getState().load();
    expect(asked()).toContain("from sponsor_data");
    store().setDataset("simulated");
    expect(useSponsor.getState()).toMatchObject({ data: null, status: "idle" });
    await store().load();
    expect(store().asOf).toBe("2025-03-15");
    await useSponsor.getState().load();
    expect(asked()).toContain("from sim_sponsor_data");
  });

  it("does not switch while a change is saving", () => {
    useStore.setState({ saving: true });
    store().setDataset("simulated");
    expect(store().dataset).toBe("original");
  });

  it.each([
    ["before the database patch", { data: null, error: { message: "Could not find the function public.sim_dataset_status without parameters in the schema cache" } }, "unpatched"],
    ["before the first simulated load", { data: false, error: null }, "empty"],
    ["when the question fails", { data: null, error: { message: "TypeError: fetch failed" } }, "unchecked"],
  ])("offers only the original %s", async (_, reply, expected) => {
    fake.status = reply;
    useStore.setState({ dataset: "simulated" });
    await store().load();
    expect(store()).toMatchObject({ simulated: expected, dataset: "original", status: "ready" });
    store().setDataset("simulated");
    expect(store().dataset).toBe("original");
    expect(asked().filter((c) => /sim_get|from sim_/.test(c))).toEqual([]);
  });

  it("drops a load that finishes after the dataset has changed", async () => {
    let release = () => {};
    fake.hold = new Promise<void>((r) => (release = r));
    const slow = store().load();
    await new Promise((r) => setTimeout(r, 0));
    store().setDataset("simulated");
    release();
    await slow;
    expect(store()).toMatchObject({ dataset: "simulated", data: null, status: "idle" });
  });

  it("asks about the dataset again once the new data appears", async () => {
    fake.status = { data: false, error: null };
    await store().load();
    store().answerChooser();
    expect(store().chooser).toBe("originalOnly");
    fake.status = { data: true, error: null };
    await store().load();
    store().answerChooser();
    expect(store().chooser).toBe("both");
  });
});

describe("chat history", () => {
  const meta = { id: "s", title: "t", createdAt: "", updatedAt: "" };
  it.each(["original", "simulated"] as const)("lists and saves only %s chats", async (ds) => {
    const chats = databaseChatStorage(db as never, ds);
    await chats.listSessions();
    await chats.createSession(meta);
    expect(asked()).toEqual(expect.arrayContaining([`from chat_sessions where dataset=${ds}`, `insert chat_sessions dataset=${ds}`]));
  });

  it("does not use the dataset column before the patch", async () => {
    const chats = databaseChatStorage(db as never, null);
    await chats.listSessions();
    await chats.createSession(meta);
    expect(asked().filter((c) => c.includes("dataset"))).toEqual([]);
  });
});

describe("the copilot's view", () => {
  it("holds no bet record from after the selected date", () => {
    const data = { ...loadSeed(), bets: { passes: [{ pass_id: "X", booked_at: "2025-04-01T10:00:00+05:30" }] } as never };
    expect(viewAsOf(data, "2025-03-15").bets!.passes).toEqual([]);
    expect(viewAsOf(data, "2025-04-01").bets!.passes).toHaveLength(1);
  });
});
