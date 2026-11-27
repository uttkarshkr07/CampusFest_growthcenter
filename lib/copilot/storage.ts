// Where chat sessions live. The screens only know this interface.
import type { ChatMessage } from "./types";
import type { DatasetId } from "@/lib/datasets";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatStorage {
  listSessions(): Promise<SessionMeta[]>;
  loadMessages(sessionId: string): Promise<ChatMessage[]>;
  createSession(meta: SessionMeta): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  /** insert, or replace the message with the same id */
  saveMessage(sessionId: string, message: ChatMessage): Promise<void>;
}

export function localChatStorage(userKey: string, dataset: DatasetId = "original"): ChatStorage {
  // chats about the original keep the key they have always had
  const root = `cfgc.chat.v1:${userKey}${dataset === "original" ? "" : `:${dataset}`}`;
  const read = <T>(key: string, fallback: T): T => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "") as T;
    } catch {
      return fallback;
    }
  };
  const write = (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the chat still works until reload */
    }
  };
  const sessions = () => read<SessionMeta[]>(root, []);
  const messages = (id: string) => read<ChatMessage[]>(`${root}:${id}`, []);
  return {
    listSessions: async () => sessions().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    loadMessages: async (id) => messages(id),
    createSession: async (meta) => write(root, [meta, ...sessions()]),
    renameSession: async (id, title) => write(root, sessions().map((s) => (s.id === id ? { ...s, title } : s))),
    deleteSession: async (id) => {
      write(root, sessions().filter((s) => s.id !== id));
      try {
        localStorage.removeItem(`${root}:${id}`);
      } catch {
        /* ignore */
      }
    },
    saveMessage: async (id, message) => {
      const list = messages(id);
      const i = list.findIndex((m) => m.id === message.id);
      if (i >= 0) list[i] = message;
      else list.push(message);
      write(`${root}:${id}`, list);
      write(root, sessions().map((s) => (s.id === id ? { ...s, updatedAt: new Date().toISOString() } : s)));
    },
  };
}
