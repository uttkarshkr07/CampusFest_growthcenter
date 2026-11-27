"use client";

import { create } from "zustand";
import type { ChangeLogRow, Dataset, SourceTable, TaskRow, CampaignPlanRow, TargetRow, CampaignRow, TicketStatus } from "@/lib/engine/types";
import { getSupabase } from "@/lib/supabase";
import { storyDates, type Story } from "@/lib/story";
import { loadDataset } from "@/lib/data/load";
import { DATASET_LABEL, isDatasetId, isMissingInDatabase, rpcName, tableName, type DatasetId } from "@/lib/datasets";


type Status = "idle" | "loading" | "ready" | "error";

/**
 * Whether the simulated dataset can be chosen. unpatched = the database has no tables for it yet;
 * empty = nothing loaded into it; unchecked = the question could not be answered (network).
 */
export type SimulatedStatus = "unknown" | "unpatched" | "empty" | "ready" | "unchecked";

/** "both" = answered while both datasets could be chosen, so it is not asked again */
export type ChooserAnswer = "both" | "originalOnly" | null;

const DATASET_KEY = "cfgc.dataset";
const CHOOSER_KEY = "cfgc.dataset.chooser";

const remembered = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
};

/** only a "no such function" reply means the database has not had the patch */
async function simulatedStatus(db: NonNullable<ReturnType<typeof getSupabase>>): Promise<SimulatedStatus> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await db.rpc("sim_dataset_status");
    if (!error) return data === true ? "ready" : "empty";
    if (isMissingInDatabase(error.message)) return "unpatched";
  }
  return "unchecked";
}

export type ThresholdPatch = Partial<{ scale_at: number; stop_at: number; min_sample: number; check_on: string | null }>;

export interface TicketInput {
  title: string;
  details: string;
  priority: "low" | "medium" | "high";
  neededBy: string | null;
}

interface State {
  /** which dataset every screen shows and changes */
  dataset: DatasetId;
  simulated: SimulatedStatus;
  chooser: ChooserAnswer;
  /** show the other dataset. Refused while a change is being saved. */
  setDataset: (dataset: DatasetId) => void;
  answerChooser: () => void;
  data: Dataset | null;
  status: Status;
  error: string | null;
  /** empty until the data is loaded */
  asOf: string;
  /** the date range and named dates, read from the data */
  story: Story | null;
  loadProgress: string;
  saving: boolean;
  toast: string | null;
  setAsOf: (d: string) => void;
  load: () => Promise<void>;
  /** forget the loaded data, for example after signing out */
  clear: () => void;
  notify: (msg: string | null) => void;
  updateSourceRow: (table: SourceTable, rowId: number, patch: Record<string, unknown>, rowRef: string) => Promise<boolean>;
  insertSourceRow: (table: SourceTable, row: Record<string, unknown>, rowRef: string) => Promise<boolean>;
  addTargetVersion: (row: Omit<TargetRow, "_row_id" | "_source" | "_deleted">) => Promise<boolean>;
  addCampaign: (row: Omit<CampaignRow, "_row_id" | "_source" | "_deleted">, budget: number | null) => Promise<boolean>;
  upsertPlan: (campaignId: string, patch: Partial<CampaignPlanRow>) => Promise<boolean>;
  createTask: (t: Omit<TaskRow, "id" | "created_at" | "updated_at">) => Promise<TaskRow | null>;
  updateTask: (id: string, patch: Partial<TaskRow>) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
  setSetting: (key: string, value: number) => Promise<boolean>;
  /** a bet threshold (an assumption). Only the simulated dataset has them. */
  updateThreshold: (rowId: number, patch: ThresholdPatch) => Promise<boolean>;
  /** false until the database has the ticket tables */
  ticketsReady: boolean;
  /** ticket changes are dated with the selected date; the database checks the team and the status step */
  raiseTicket: (t: TicketInput & { fromTeam: string; toTeam: string; assigneeId: string | null }) => Promise<boolean>;
  editTicket: (id: string, t: TicketInput) => Promise<boolean>;
  moveTicket: (id: string, status: TicketStatus, note: string | null) => Promise<boolean>;
  commentTicket: (id: string, body: string) => Promise<boolean>;
  resetDemo: () => Promise<boolean>;
}

const EMPTY_APP = { campaign_plan: [], team: [], tasks: [], settings: [], change_log: [], tickets: [], ticket_events: [] };

/** before the ticket patch, tasks have no ticket or story date columns */
function taskColumns<T extends object>(row: T, ready: boolean): T {
  if (ready) return row;
  const rest = { ...row } as Record<string, unknown>;
  delete rest.ticket_id;
  delete rest.story_date;
  return rest as T;
}

// a blocked change comes back either as a policy error or as "no row changed"
const BLOCKED = /row-level security|multiple \(or no\) rows|coerce the result to a single/i;

export const useStore = create<State>((set, get) => {
  // goes up whenever the data on screen is dropped, so a slow load cannot put it back
  let generation = 0;
  let saves = 0;
  // the saved choice is read once, in the browser
  let restored = false;
  /** the database table or function for the dataset on screen */
  const table = (name: string) => tableName(get().dataset, name);
  const rpc = (name: string) => rpcName(get().dataset, name);

  /** Write to change_log in the DB and locally. Never blocks the main write. */
  async function log(entries: Omit<ChangeLogRow, "id" | "changed_at">[]) {
    const db = getSupabase();
    if (!db || entries.length === 0) return;
    const { data: rows } = await db.from(table("change_log")).insert(entries).select();
    if (rows) set((s) => (s.data ? { data: { ...s.data, change_log: [...s.data.change_log, ...(rows as ChangeLogRow[])] } } : {}));
  }

  async function guard<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | null> {
    saves++;
    set({ saving: true });
    try {
      const r = await fn();
      if (okMsg) set({ toast: okMsg });
      return r;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ toast: BLOCKED.test(message) ? "Not saved: your account is not allowed to make this change." : `Save failed: ${message}` });
      return null;
    } finally {
      saves--;
      set({ saving: saves > 0 });
    }
  }

  const replaceData = (patch: Partial<Dataset>) => set((s) => (s.data ? { data: { ...s.data, ...patch } } : {}));

  /** a ticket change runs in the database, then tickets are read back */
  async function ticketChange(fn: string, args: Record<string, unknown>, okMsg: string) {
    const done = await guard(async () => {
      const db = getSupabase()!;
      const { error } = await db.rpc(rpc(fn), args);
      if (error) throw new Error(error.message);
      const [tickets, events] = await Promise.all([db.from(table("tickets")).select("*").order("raised_on").order("created_at"), db.from(table("ticket_events")).select("*").order("id")]);
      if (tickets.error || events.error) throw new Error("Saved, but the tickets could not be read back. Reload the page.");
      replaceData({ tickets: tickets.data, ticket_events: events.data } as Partial<Dataset>);
      return true;
    }, okMsg);
    return !!done;
  }

  return {
    dataset: "original",
    simulated: "unknown",
    chooser: null,
    setDataset: (dataset) => {
      const now = get();
      if (dataset === now.dataset || now.saving || (dataset === "simulated" && now.simulated !== "ready")) return;
      generation++;
      remember(DATASET_KEY, dataset);
      // the screen loads the chosen dataset when it sees "idle"; the selected date is kept
      set({ dataset, data: null, status: "idle", error: null, story: null, toast: null });
    },
    answerChooser: () => {
      const chooser = get().simulated === "ready" ? "both" : "originalOnly";
      remember(CHOOSER_KEY, chooser);
      set({ chooser });
    },
    data: null,
    status: "idle",
    error: null,
    asOf: "",
    story: null,
    loadProgress: "",
    saving: false,
    toast: null,
    ticketsReady: false,
    setAsOf: (d) => set({ asOf: d }),
    notify: (msg) => set({ toast: msg }),
    clear: () => {
      generation++;
      restored = false;
      set({ data: null, status: "idle", error: null, simulated: "unknown" });
    },

    load: async () => {
      const db = getSupabase();
      if (!db) {
        set({ status: "error", error: "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." });
        return;
      }
      const mine = ++generation;
      set({ status: "loading", error: null, loadProgress: "Loading the dataset..." });
      try {
        const simulated = await simulatedStatus(db);
        if (mine !== generation) return;
        let dataset = get().dataset;
        if (!restored) {
          restored = true;
          const saved = remembered(DATASET_KEY);
          if (isDatasetId(saved)) dataset = saved;
          const chooser = remembered(CHOOSER_KEY);
          set({ chooser: chooser === "both" || chooser === "originalOnly" ? chooser : null });
        }
        // the original is always there; the simulated one only when it can be read
        if (simulated !== "ready") dataset = "original";
        set({ simulated, dataset });
        const result = await loadDataset(db, dataset, (loadProgress) => {
          if (mine === generation) set({ loadProgress });
        });
        if (mine !== generation) return;
        const loaded = { ...EMPTY_APP, ...result.data };
        const story = storyDates(loaded);
        const picked = get().asOf;
        // keep the date already chosen if the data still covers it; otherwise show the end of the story
        set({ data: loaded, status: "ready", ticketsReady: result.hasTickets, story, asOf: picked >= story.min && picked <= story.max ? picked : story.post });
      } catch (e) {
        if (mine === generation) set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },

    updateSourceRow: async (table, rowId, patch, rowRef) => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const before = get().data?.[table].find((x) => x._row_id === rowId) as Record<string, unknown> | undefined;
        const { data, error } = await db.from(tableName(get().dataset, table)).update(patch).eq("_row_id", rowId).select().single();
        if (error) throw new Error(error.message);
        replaceData({ [table]: (get().data![table] as { _row_id?: number }[]).map((x) => (x._row_id === rowId ? data : x)) } as Partial<Dataset>);
        await log(Object.keys(patch).map((field) => ({ table_name: table, row_ref: rowRef, field, old_value: before?.[field] ?? null, new_value: patch[field] ?? null })));
        return true;
      }, "Saved. Every number has been recalculated.");
      return !!r;
    },

    insertSourceRow: async (table, row, rowRef) => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const { data, error } = await db.from(tableName(get().dataset, table)).insert({ ...row, _source: "app" }).select().single();
        if (error) throw new Error(error.message);
        replaceData({ [table]: [...(get().data![table] as object[]), data] } as Partial<Dataset>);
        await log([{ table_name: table, row_ref: rowRef, field: "(new row)", old_value: null, new_value: row }]);
        return true;
      }, "Row added. Every number has been recalculated.");
      return !!r;
    },

    addTargetVersion: async (row) => get().insertSourceRow("targets", row as unknown as Record<string, unknown>, row.target_version),

    addCampaign: async (row, budget) => {
      const ok = await get().insertSourceRow("campaigns", row as unknown as Record<string, unknown>, row.campaign_id);
      if (ok) await get().upsertPlan(row.campaign_id, { app_status: "planned", budget_inr: budget });
      return ok;
    },

    upsertPlan: async (campaignId, patch) => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const before = get().data!.campaign_plan.find((p) => p.campaign_id === campaignId);
        const next = { campaign_id: campaignId, app_status: before?.app_status ?? "active", budget_inr: before?.budget_inr ?? null, notes: before?.notes ?? null, ...patch, updated_at: new Date().toISOString() };
        const { data, error } = await db.from(table("campaign_plan")).upsert(next).select().single();
        if (error) throw new Error(error.message);
        replaceData({ campaign_plan: [...get().data!.campaign_plan.filter((p) => p.campaign_id !== campaignId), data as CampaignPlanRow] });
        await log(
          Object.keys(patch).map((field) => ({
            table_name: "campaign_plan",
            row_ref: campaignId,
            field,
            old_value: (before as unknown as Record<string, unknown> | undefined)?.[field] ?? null,
            new_value: (patch as Record<string, unknown>)[field] ?? null,
          })),
        );
        return true;
      }, "Campaign plan saved.");
      return !!r;
    },

    createTask: async (t) =>
      guard(async () => {
        const db = getSupabase()!;
        const { data, error } = await db.from(table("tasks")).insert(taskColumns(t, get().ticketsReady)).select().single();
        if (error) throw new Error(error.message);
        replaceData({ tasks: [...get().data!.tasks, data as TaskRow] });
        await log([{ table_name: "tasks", row_ref: (data as TaskRow).id, field: "(created)", old_value: null, new_value: { title: t.title, origin: t.origin } }]);
        return data as TaskRow;
      }, "Task created."),

    updateTask: async (id, patch) => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const before = get().data!.tasks.find((x) => x.id === id);
        const { data, error } = await db.from(table("tasks")).update(taskColumns({ ...patch, updated_at: new Date().toISOString() }, get().ticketsReady)).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        replaceData({ tasks: get().data!.tasks.map((x) => (x.id === id ? (data as TaskRow) : x)) });
        await log(Object.keys(patch).map((field) => ({ table_name: "tasks", row_ref: id, field, old_value: (before as unknown as Record<string, unknown>)?.[field] ?? null, new_value: (patch as Record<string, unknown>)[field] ?? null })));
        return true;
      }, "Task saved.");
      return !!r;
    },

    deleteTask: async (id) => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const { data: removed, error } = await db.from(table("tasks")).delete().eq("id", id).select("id");
        if (error) throw new Error(error.message);
        // a delete that is not allowed removes nothing and reports no error
        if (!removed?.length) throw new Error("row-level security");
        const before = get().data!.tasks.find((x) => x.id === id);
        replaceData({ tasks: get().data!.tasks.filter((x) => x.id !== id) });
        await log([{ table_name: "tasks", row_ref: id, field: "(deleted)", old_value: before?.title ?? null, new_value: null }]);
        return true;
      }, "Task deleted.");
      return !!r;
    },

    setSetting: async (key, value) => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const before = get().data!.settings.find((s) => s.key === key);
        const { error } = await db.from(table("settings")).upsert({ key, value });
        if (error) throw new Error(error.message);
        replaceData({ settings: [...get().data!.settings.filter((s) => s.key !== key), { key, value }] });
        await log([{ table_name: "settings", row_ref: key, field: "value", old_value: before?.value ?? null, new_value: value }]);
        return true;
      }, "Setting saved. Projections and flags have been recalculated.");
      return !!r;
    },

    updateThreshold: async (rowId, patch) => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const rows = get().data!.bets!.bet_thresholds;
        const before = rows.find((x) => x._row_id === rowId);
        const { data, error } = await db.from(table("bet_thresholds")).update(patch).eq("_row_id", rowId).select().single();
        if (error) throw new Error(error.message);
        // a new bets object, so every figure worked out from the old one is dropped
        replaceData({ bets: { ...get().data!.bets!, bet_thresholds: rows.map((x) => (x._row_id === rowId ? data : x)) } });
        await log(Object.entries(patch).map(([field, value]) => ({ table_name: "bet_thresholds", row_ref: String(before?.threshold_id ?? rowId), field, old_value: before?.[field] ?? null, new_value: value ?? null })));
        return true;
      }, "Threshold saved. Verdicts have been recalculated.");
      return !!r;
    },

    raiseTicket: async (t) =>
      ticketChange("raise_ticket", { p_title: t.title, p_details: t.details, p_from: t.fromTeam, p_to: t.toTeam, p_priority: t.priority, p_needed_by: t.neededBy, p_assignee: t.assigneeId, p_on: get().asOf }, "Ticket raised."),
    editTicket: async (id, t) => ticketChange("edit_ticket", { p_id: id, p_title: t.title, p_details: t.details, p_priority: t.priority, p_needed_by: t.neededBy, p_on: get().asOf }, "Request updated."),
    moveTicket: async (id, status, note) => ticketChange("move_ticket", { p_id: id, p_status: status, p_note: note, p_on: get().asOf }, "Ticket updated."),
    commentTicket: async (id, body) => ticketChange("comment_ticket", { p_id: id, p_body: body, p_on: get().asOf }, "Comment added."),

    resetDemo: async () => {
      const r = await guard(async () => {
        const db = getSupabase()!;
        const { error } = await db.rpc(rpc("reset_demo"));
        if (error) throw new Error(error.message);
        await get().load();
        return true;
      }, `${DATASET_LABEL[get().dataset]}: restored to the loaded data.`);
      return !!r;
    },
  };
});
