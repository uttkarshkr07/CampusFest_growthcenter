// Chat history in the database, for signed-in accounts. Row rules (patch_session3a.sql) limit
// every read and write to the signed-in account's own chats.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatStorage, SessionMeta } from "./storage";
import type { ChatMessage } from "./types";

const MAX_SESSIONS = 200;
const MAX_MESSAGES = 500;

function check(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function databaseChatStorage(db: SupabaseClient): ChatStorage {
  return {
    listSessions: async () => {
      const { data, error } = await db.from("chat_sessions").select("id, title, created_at, updated_at").order("updated_at", { ascending: false }).limit(MAX_SESSIONS);
      check("list chats", error);
      return (data ?? []).map((r): SessionMeta => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
    },
    loadMessages: async (sessionId) => {
      const { data, error } = await db.from("chat_messages").select("body").eq("session_id", sessionId).order("created_at", { ascending: true }).limit(MAX_MESSAGES);
      check("open chat", error);
      return (data ?? []).map((r) => r.body as ChatMessage);
    },
    createSession: async (meta) => {
      const { error } = await db.from("chat_sessions").insert({ id: meta.id, title: meta.title.slice(0, 80) });
      check("start chat", error);
    },
    renameSession: async (sessionId, title) => {
      const { error } = await db.from("chat_sessions").update({ title: title.slice(0, 80) }).eq("id", sessionId);
      check("rename chat", error);
    },
    deleteSession: async (sessionId) => {
      // the messages go with it (on delete cascade)
      const { error } = await db.from("chat_sessions").delete().eq("id", sessionId);
      check("delete chat", error);
    },
    saveMessage: async (sessionId, message) => {
      // an update keeps the original created_at, so the order of a chat never changes
      const { error } = await db.from("chat_messages").upsert({ id: message.id, session_id: sessionId, as_of: message.asOf, body: message });
      check("save message", error);
      const touched = await db.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
      check("save chat", touched.error);
    },
  };
}
