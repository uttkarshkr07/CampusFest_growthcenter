"use client";

import { create } from "zustand";
import { SPONSOR_SHEETS, type SponsorData } from "@/lib/engine/sponsor";
import { getSupabase } from "@/lib/supabase";

/**
 * Sponsor records load separately, only when the sponsor screen or the copilot needs them,
 * so the attendee screens do not wait for them.
 */
interface SponsorState {
  data: SponsorData | null;
  status: "idle" | "loading" | "ready" | "missing" | "error";
  error: string | null;
  load: () => Promise<SponsorData | null>;
  clear: () => void;
}

let pending: Promise<SponsorData | null> | null = null;
// goes up on sign-out, so a slow load for one account is dropped
let generation = 0;

export const useSponsor = create<SponsorState>((set, get) => ({
  data: null,
  status: "idle",
  error: null,

  load: () => {
    const have = get().data;
    if (have) return Promise.resolve(have);
    if (pending) return pending;
    const mine = generation;
    set({ status: "loading", error: null });
    pending = (async () => {
      const db = getSupabase();
      if (!db) throw new Error("The database is not configured.");
      const { data, error } = await db.from("sponsor_data").select("sheet, rows");
      // before the table exists, or before it is loaded
      if (error && /could not find the table|does not exist/i.test(error.message)) return null;
      if (error) throw new Error(error.message);
      const bySheet = new Map((data ?? []).map((r) => [r.sheet as string, r.rows as unknown[]]));
      if (!SPONSOR_SHEETS.every((s) => bySheet.has(s))) return null;
      return Object.fromEntries(SPONSOR_SHEETS.map((s) => [s, bySheet.get(s)])) as unknown as SponsorData;
    })()
      .then((loaded) => {
        if (mine !== generation) return null;
        set(loaded ? { data: loaded, status: "ready" } : { status: "missing" });
        return loaded;
      })
      .catch((e: unknown) => {
        if (mine === generation) set({ status: "error", error: e instanceof Error ? e.message : String(e) });
        return null;
      })
      .finally(() => {
        if (mine === generation) pending = null;
      });
    return pending;
  },

  clear: () => {
    generation++;
    pending = null;
    set({ data: null, status: "idle", error: null });
  },
}));
