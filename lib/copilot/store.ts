"use client";

import { create } from "zustand";
import { AUTH_ON } from "@/lib/auth/config";
import { accessToken, useAuth } from "@/lib/auth/store";
import { ANSWER_LABEL, DATASET_LABEL, type DatasetId } from "@/lib/datasets";
import { buildSummary, executeSponsorTool, executeToolAsOf } from "@/lib/engine";
import { useSponsor } from "@/lib/sponsor/store";
import { useStore } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { callModel } from "./client";
import { runTurn } from "./loop";
import { SPONSOR_TOOL } from "./tool-defs.names";
import { localChatStorage, type ChatStorage, type SessionMeta } from "./storage";
import { databaseChatStorage } from "./storage-db";
import type { ChatAction, ChatMessage } from "./types";

const LOAD_FAILED = "Chat history could not be loaded. You can still ask questions.";
const SAVE_FAILED = "This chat could not be saved, so it may be missing after a reload.";
const CHANGE_FAILED = "That change to the chat history did not save. Please try again.";

interface ChatState {
  open: boolean;
  sessions: SessionMeta[];
  currentId: string | null;
  messages: ChatMessage[];
  busy: boolean;
  /** history is being fetched; sending waits so the model never gets half a chat */
  loading: boolean;
  /** a history problem to show beside the chat */
  notice: string | null;
  status: string;
  model: { configured: boolean; models: string[] } | null;
  userKey: string | null;
  /** the account and dataset whose chats are listed */
  historyKey: string | null;
  setOpen: (open: boolean) => void;
  /** a question waiting in the input box, put there by another screen; never sent automatically */
  pending: string | null;
  /** open the panel with this question in the box */
  prefill: (question: string) => void;
  takePending: () => string | null;
  /** datasetColumn is false only before the database patch that adds it */
  init: (userKey: string, dataset: DatasetId, datasetColumn: boolean) => Promise<void>;
  /** forget the previous account's chats after signing out */
  reset: () => void;
  newChat: () => void;
  openSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (question: string) => Promise<void>;
  setActionStatus: (messageId: string, actionId: string, status: "created" | "dismissed", taskId?: string) => Promise<void>;
}

// Everything async checks `storage === own` before writing to the screen, so a slow answer or
// load from one account can never appear under another.
let storage: ChatStorage | null = null;

/** Signed-in accounts keep chats in the database; without sign-in they stay in this browser. */
function storageFor(userKey: string, dataset: DatasetId, datasetColumn: boolean): ChatStorage {
  const db = AUTH_ON && userKey !== "local" ? getSupabase() : null;
  return db ? databaseChatStorage(db, datasetColumn ? dataset : null) : localChatStorage(userKey, dataset);
}

/** The reason goes on screen and into the console, so a failure can be diagnosed from either. */
function explain(summary: string, error: unknown): string {
  console.error("chat history:", error);
  const reason = error instanceof Error ? error.message : String(error);
  return `${summary} Reason: ${reason.slice(0, 200)}`;
}

const EMPTY = {sessions: [] as SessionMeta[], currentId: null, messages: [] as ChatMessage[], busy: false, loading: false, notice: null, status: "" };

export const useChat = create<ChatState>((set, get) => ({
  ...EMPTY,
  open: false,
  model: null,
  userKey: null,
  historyKey: null,

  setOpen: (open) => set({ open }),
  pending: null,
  prefill: (question) => set({ open: true, pending: question }),
  takePending: () => {
    const q = get().pending;
    if (q != null) set({ pending: null });
    return q;
  },

  reset: () => {
    storage = null;
    set({ ...EMPTY, open: false, userKey: null, historyKey: null });
  },

  init: async (userKey, dataset, datasetColumn) => {
    const historyKey = `${userKey}|${dataset}|${datasetColumn}`;
    if (get().historyKey === historyKey) return;
    const own = storageFor(userKey, dataset, datasetColumn);
    storage = own;
    set({ ...EMPTY, userKey, historyKey, loading: true });
    try {
      const sessions = await own.listSessions();
      const currentId = sessions[0]?.id ?? null;
      const messages = currentId ? await own.loadMessages(currentId) : [];
      if (storage === own) set({ sessions, currentId, messages });
    } catch (e) {
      if (storage === own) set({ notice: explain(LOAD_FAILED, e) });
    } finally {
      if (storage === own) set({ loading: false });
    }
    try {
      const res = await fetch("/api/copilot");
      if (res.ok) set({ model: await res.json() });
    } catch {
      /* the first question will report the problem */
    }
  },

  newChat: () => {
    if (!get().busy) set({ currentId: null, messages: [], loading: false, notice: null });
  },

  openSession: async (id) => {
    const own = storage;
    if (get().busy || !own) return;
    set({ currentId: id, messages: [], loading: true, notice: null });
    const stillWanted = () => storage === own && get().currentId === id;
    try {
      const messages = await own.loadMessages(id);
      if (stillWanted()) set({ messages, loading: false });
    } catch (e) {
      if (stillWanted()) set({ notice: explain(LOAD_FAILED, e), loading: false });
    }
  },

  renameSession: async (id, title) => {
    const own = storage;
    const clean = title.trim().slice(0, 80);
    if (!clean || !own) return;
    try {
      await own.renameSession(id, clean);
      const sessions = await own.listSessions();
      if (storage === own) set({ sessions, notice: null });
    } catch (e) {
      if (storage === own) set({ notice: explain(CHANGE_FAILED, e) });
    }
  },

  deleteSession: async (id) => {
    const own = storage;
    if (!own || (get().busy && get().currentId === id)) return;
    try {
      await own.deleteSession(id);
      const sessions = await own.listSessions();
      if (storage !== own) return;
      if (get().currentId === id) set({ sessions, currentId: null, messages: [], notice: null, loading: false });
      else set({ sessions, notice: null });
    } catch (e) {
      if (storage === own) set({ notice: explain(CHANGE_FAILED, e) });
    }
  },

  send: async (question) => {
    const text = question.trim().slice(0, 1000);
    const { data, asOf, dataset } = useStore.getState();
    // this account's storage, kept even if someone switches account while the answer is on its way
    const own = storage;
    if (!text || get().busy || get().loading || !data || !own) return;
    // the toggle is locked while an answer is on its way; this also makes sure a lookup never reads the other dataset
    const current = () => {
      const now = useStore.getState();
      return (now.dataset === dataset ? now.data : null) ?? data;
    };
    const me = useAuth.getState().me;
    const history = get().messages;
    const isNew = !get().currentId;
    const sessionId = get().currentId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const user: ChatMessage = { id: crypto.randomUUID(), role: "user", text, asOf, createdAt: now };
    set({ busy: true, status: "Reading the data...", notice: null, currentId: sessionId, messages: [...history, user] });

    // a history problem must not stop the answer
    const keep = async (save: () => Promise<void>) => {
      try {
        await save();
      } catch (e) {
        const message = explain(SAVE_FAILED, e);
        if (storage === own && !get().notice) set({ notice: message });
      }
    };
    const refreshList = async () => {
      const sessions = await own.listSessions();
      if (storage === own) set({ sessions });
    };

    try {
      await keep(async () => {
        // the title is the first question, so naming a chat costs no model request
        if (isNew) await own.createSession({ id: sessionId, title: text.slice(0, 60), createdAt: now, updatedAt: now });
        await own.saveMessage(sessionId, user);
        await refreshList();
      });
      let reply: ChatMessage;
      try {
        reply = await runTurn({
          question: text,
          selectedDate: asOf,
          summary: buildSummary(data, asOf),
          context: { today: asOf, dataset: dataset === "simulated" ? `${DATASET_LABEL.simulated} (a made-up simulation, not real results)` : DATASET_LABEL.original, ...(me ? { signedInUser: { name: me.name, teams: me.teams, isReviewer: me.isReviewer } } : {}) },
          history,
          datasetLabel: ANSWER_LABEL[dataset],
          callModel: async (req) => callModel(req, await accessToken()),
          // read the store again so a data edit made mid-answer is used
          runTool: (name, args) =>
            name === SPONSOR_TOOL
              ? useSponsor.getState().load().then((sponsor) => executeSponsorTool(sponsor, args, asOf))
              : executeToolAsOf(current(), name, args, asOf),
          onStatus: (status) => storage === own && set({ status }),
        });
      } catch (e) {
        reply = { id: crypto.randomUUID(), role: "assistant", text: e instanceof Error ? e.message : "Something went wrong.", asOf, createdAt: new Date().toISOString(), error: true };
      }
      if (storage === own && get().currentId === sessionId) set({ messages: [...get().messages, reply] });
      await keep(async () => {
        await own.saveMessage(sessionId, reply);
        await refreshList();
      });
    } finally {
      if (storage === own) set({ busy: false, status: "" });
    }
  },

  setActionStatus: async (messageId, actionId, status, taskId) => {
    const own = storage;
    const { currentId, messages } = get();
    const message = messages.find((m) => m.id === messageId);
    if (!message || !currentId || !own) return;
    const next: ChatMessage = { ...message, actions: message.actions?.map((a): ChatAction => (a.id === actionId && a.type === "task" ? { ...a, status, taskId } : a)) };
    set({ messages: messages.map((m) => (m.id === messageId ? next : m)) });
    try {
      await own.saveMessage(currentId, next);
    } catch (e) {
      if (storage === own) set({ notice: explain(SAVE_FAILED, e) });
    }
  },
}));
