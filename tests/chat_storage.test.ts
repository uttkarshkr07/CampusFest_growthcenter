// Opt-in check of chat history against the real database, with two real demo accounts.
//   CHAT_LIVE=1 npx vitest run tests/chat_storage.test.ts
// Needs NEXT_PUBLIC_DEMO_PASSWORD in .env.local. It creates one temporary chat and removes it.
// It does not touch the event data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ACCOUNTS } from "@/lib/auth/permissions";
import { databaseChatStorage } from "@/lib/copilot/storage-db";
import type { ChatMessage } from "@/lib/copilot/types";

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.resolve(__dirname, "../.env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

describe.skipIf(!process.env.CHAT_LIVE)("chat history in the real database", () => {
  it("saves, reopens, renames and deletes a chat that only its owner can reach", async () => {
    const e = env();
    const signIn = async (key: string) => {
      const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await db.auth.signInWithPassword({ email: ACCOUNTS.find((a) => a.key === key)!.email, password: e.NEXT_PUBLIC_DEMO_PASSWORD });
      if (error) throw new Error(`${key} sign-in failed: ${error.message}`);
      return databaseChatStorage(db);
    };
    const mine = await signIn("reviewer");
    const other = await signIn("arjun");
    const id = crypto.randomUUID();
    const message = (role: "user" | "assistant", text: string): ChatMessage => ({ id: crypto.randomUUID(), role, text, asOf: "2025-03-15", createdAt: new Date().toISOString() });
    const question = message("user", "storage check question");
    const answer = message("assistant", "storage check answer");
    const now = new Date().toISOString();
    try {
      await mine.createSession({ id, title: "storage check (temporary)", createdAt: now, updatedAt: now });
      await mine.saveMessage(id, question);
      await mine.saveMessage(id, answer);
      expect((await mine.loadMessages(id)).map((m) => m.text)).toEqual(["storage check question", "storage check answer"]);

      // saving the same message again updates it in place and keeps the order
      await mine.saveMessage(id, { ...question, text: "storage check question, edited" });
      expect((await mine.loadMessages(id)).map((m) => m.text)).toEqual(["storage check question, edited", "storage check answer"]);

      await mine.renameSession(id, "storage check renamed");
      expect((await mine.listSessions()).find((s) => s.id === id)?.title).toBe("storage check renamed");

      expect((await other.listSessions()).some((s) => s.id === id)).toBe(false);
      expect(await other.loadMessages(id)).toEqual([]);
      await expect(other.saveMessage(id, message("user", "intruder"))).rejects.toThrow();
      await other.deleteSession(id);
      expect((await mine.loadMessages(id)).length).toBe(2);
    } finally {
      await mine.deleteSession(id);
    }
    expect((await mine.listSessions()).some((s) => s.id === id)).toBe(false);
    expect(await mine.loadMessages(id)).toEqual([]);
  }, 60_000);
});
