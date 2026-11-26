"use client";

import { create } from "zustand";
import { accessToken, useAuth } from "@/lib/auth/store";
import { buildSummary, executeToolAsOf } from "@/lib/engine";
import { useStore } from "@/lib/store";
import { callModel } from "./client";
import { runTurn } from "./loop";
import { localChatStorage, type ChatStorage, type SessionMeta } from "./storage";
import type { ChatAction, ChatMessage } from "./types";

interface ChatState {
  open: boolean;
  sessions: SessionMeta[];
  currentId: string | null;
  messages: ChatMessage[];
  busy: boolean;
  status: string;
  model: { configured: boolean; models: string[] } | null;
  userKey: string | null;
  setOpen: (open: boolean) => void;
  init: (userKey: string) => Promise<void>;
  /** forget the previous account's chats after signing out */
  reset: () => void;
  newChat: () => void;
  openSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (question: string) => Promise<void>;
  setActionStatus: (messageId: string, actionId: string, status: "created" | "dismissed", taskId?: string) => Promise<void>;
}

let storage: ChatStorage | null = null;

export const useChat = create<ChatState>((set, get) => ({
  open: false,
  sessions: [],
  currentId: null,
  messages: [],
  busy: false,
  status: "",
  model: null,
  userKey: null,

  setOpen: (open) => set({ open }),

  reset: () => {
    storage = null;
    set({ open: false, sessions: [], currentId: null, messages: [], userKey: null });
  },

  init: async (userKey) => {
    if (get().userKey === userKey) return;
    storage = localChatStorage(userKey);
    const sessions = await storage.listSessions();
    const currentId = sessions[0]?.id ?? null;
    set({ userKey, sessions, currentId, messages: currentId ? await storage.loadMessages(currentId) : [] });
    try {
      const res = await fetch("/api/copilot");
      if (res.ok) set({ model: await res.json() });
    } catch {
      /* the first question will report the problem */
    }
  },

  newChat: () => {
    if (!get().busy) set({ currentId: null, messages: [] });
  },

  openSession: async (id) => {
    if (get().busy || !storage) return;
    set({ currentId: id, messages: await storage.loadMessages(id) });
  },

  renameSession: async (id, title) => {
    const clean = title.trim().slice(0, 80);
    if (!clean || !storage) return;
    await storage.renameSession(id, clean);
    set({ sessions: await storage.listSessions() });
  },

  deleteSession: async (id) => {
    if (!storage || (get().busy && get().currentId === id)) return;
    await storage.deleteSession(id);
    const sessions = await storage.listSessions();
    if (get().currentId === id) set({ sessions, currentId: null, messages: [] });
    else set({ sessions });
  },

  send: async (question) => {
    const text = question.trim().slice(0, 1000);
    const { data, asOf } = useStore.getState();
    // keep this account's storage even if someone switches account while the answer is on its way
    const own = storage;
    if (!text || get().busy || !data || !own) return;
    const me = useAuth.getState().me;
    const history = get().messages;
    let sessionId = get().currentId;
    const now = new Date().toISOString();
    const user: ChatMessage = { id: crypto.randomUUID(), role: "user", text, asOf, createdAt: now };
    set({ busy: true, status: "Reading the data...", messages: [...history, user] });
    try {
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        // the title is the first question, so naming a chat costs no model request
        await own.createSession({ id: sessionId, title: text.slice(0, 60), createdAt: now, updatedAt: now });
        set({ currentId: sessionId });
      }
      await own.saveMessage(sessionId, user);
      set({ sessions: await own.listSessions() });
      let reply: ChatMessage;
      try {
        reply = await runTurn({
          question: text,
          selectedDate: asOf,
          summary: buildSummary(data, asOf),
          context: { today: asOf, ...(me ? { signedInUser: { name: me.name, teams: me.teams, isReviewer: me.isReviewer } } : {}) },
          history,
          callModel: async (req) => callModel(req, await accessToken()),
          // read the store again so a data edit made mid-answer is used
          runTool: (name, args) => executeToolAsOf(useStore.getState().data ?? data, name, args, asOf),
          onStatus: (status) => set({ status }),
        });
      } catch (e) {
        reply = { id: crypto.randomUUID(), role: "assistant", text: e instanceof Error ? e.message : "Something went wrong.", asOf, createdAt: new Date().toISOString(), error: true };
      }
      await own.saveMessage(sessionId, reply);
      if (storage === own && get().currentId === sessionId) set({ messages: [...get().messages, reply] });
    } finally {
      set({ busy: false, status: "" });
    }
  },

  setActionStatus: async (messageId, actionId, status, taskId) => {
    const { currentId, messages } = get();
    const message = messages.find((m) => m.id === messageId);
    if (!message || !currentId || !storage) return;
    const next: ChatMessage = { ...message, actions: message.actions?.map((a): ChatAction => (a.id === actionId && a.type === "task" ? { ...a, status, taskId } : a)) };
    set({ messages: messages.map((m) => (m.id === messageId ? next : m)) });
    await storage.saveMessage(currentId, next);
  },
}));
