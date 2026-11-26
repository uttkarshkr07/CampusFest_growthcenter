"use client";

import { create } from "zustand";
import { getSupabase } from "@/lib/supabase";
import { AUTH_ON, DEMO_PASSWORD } from "./config";
import { ACCOUNTS, type Me, type Team } from "./permissions";

interface AuthState {
  status: "checking" | "signedOut" | "ready";
  /** null when sign-in is switched off */
  me: Me | null;
  busyKey: string | null;
  error: string | null;
  init: () => Promise<void>;
  signIn: (accountKey: string) => Promise<void>;
  signOut: () => Promise<void>;
}

async function loadMe(userId: string): Promise<Me | null> {
  const db = getSupabase()!;
  const [profile, teams] = await Promise.all([
    db.from("profiles").select("person_id, display_name, is_reviewer").eq("user_id", userId).maybeSingle(),
    db.from("memberships").select("team").eq("user_id", userId),
  ]);
  if (profile.error || teams.error || !profile.data) return null;
  return {
    userId,
    name: profile.data.display_name,
    personId: profile.data.person_id,
    isReviewer: profile.data.is_reviewer,
    teams: (teams.data ?? []).map((t) => t.team as Team),
  };
}

let started = false;

export const useAuth = create<AuthState>((set) => ({
  status: AUTH_ON ? "checking" : "ready",
  me: null,
  busyKey: null,
  error: null,

  init: async () => {
    if (!AUTH_ON || started) return;
    started = true;
    const db = getSupabase();
    if (!db) return set({ status: "signedOut", error: "The database is not configured." });
    db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") set({ status: "signedOut", me: null });
    });
    const { data } = await db.auth.getSession();
    const me = data.session ? await loadMe(data.session.user.id) : null;
    set(me ? { status: "ready", me } : { status: "signedOut" });
  },

  signIn: async (accountKey) => {
    const db = getSupabase();
    const account = ACCOUNTS.find((a) => a.key === accountKey);
    if (!db || !account) return;
    if (!DEMO_PASSWORD) return set({ error: "This build has no demo password, so the accounts cannot sign in." });
    set({ busyKey: accountKey, error: null });
    const { data, error } = await db.auth.signInWithPassword({ email: account.email, password: DEMO_PASSWORD });
    if (error || !data.user) return set({ busyKey: null, error: `Sign-in failed: ${error?.message ?? "no user returned"}` });
    const me = await loadMe(data.user.id);
    if (!me) {
      await db.auth.signOut({ scope: "local" });
      return set({ busyKey: null, error: "This account has no profile yet. The account setup script needs to be run." });
    }
    set({ status: "ready", me, busyKey: null });
  },

  signOut: async () => {
    // "local" matters: demo accounts are shared, and the default would sign everyone else out too
    await getSupabase()?.auth.signOut({ scope: "local" });
    set({ status: "signedOut", me: null, error: null });
  },
}));

/** The signed-in user's token, for the copilot endpoint. */
export async function accessToken(): Promise<string | null> {
  if (!AUTH_ON) return null;
  const { data } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}
