// Live check against the real Supabase project, using the ANON key exactly like the browser.
// Skipped by default. Run with:  LIVE=1 npx vitest run tests/live.test.ts
// WARNING: it edits one check-in and then calls reset_demo(), which wipes any edits and tasks.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as E from "@/lib/engine";
import { ACCOUNTS } from "@/lib/auth/permissions";
import type { Dataset } from "@/lib/engine";

const POST = "2025-04-20";

function env(): Record<string, string> {
  const txt = readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
  return Object.fromEntries(
    txt
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

describe.skipIf(!process.env.LIVE)("live Supabase via anon key", () => {
  const e = env();
  const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const signIn = async () => {
    if (!e.NEXT_PUBLIC_DEMO_PASSWORD) return;
    const reviewer = ACCOUNTS.find((a) => a.reviewer)!;
    const { error } = await db.auth.signInWithPassword({ email: reviewer.email, password: e.NEXT_PUBLIC_DEMO_PASSWORD });
    if (error) throw new Error(`Reviewer sign-in failed: ${error.message}`);
  };
  const fetchData = async () => {
    const { data, error } = await db.rpc("get_dataset");
    if (error) throw new Error(error.message);
    return data as Dataset;
  };
  const attendees = (d: Dataset) => E.funnel(d, POST).value.actualAttendees;

  it("get_dataset matches the handoff oracles, edit flows through, reset restores", async () => {
    await signIn();
    const d = await fetchData();
    const f = E.funnel(d, POST).value;
    expect(f.stages.find((s) => s.key === "identified")!.count).toBe(3625);
    expect(f.stages.find((s) => s.key === "registered")!.count).toBe(2800);
    expect(f.actualAttendees).toBe(2050);
    expect(d.team.length).toBe(6);
    expect(d.settings.length).toBe(9);

    // pick a check-in whose denial removes exactly one attendee (decided locally, then written live)
    const target = d.checkins.find((c) => {
      if (c.result !== "admitted" || c.verification !== "verified") return false;
      const copy = { ...d, checkins: d.checkins.map((x) => (x._row_id === c._row_id ? { ...x, result: "denied" } : x)) } as Dataset;
      return attendees(copy) === 2049;
    })!;
    expect(target).toBeTruthy();
    const { error: upErr } = await db.from("checkins").update({ result: "denied" }).eq("_row_id", target._row_id!);
    expect(upErr).toBeNull();
    expect(attendees(await fetchData())).toBe(2049);

    const { error: resetErr } = await db.rpc("reset_demo");
    expect(resetErr).toBeNull();
    expect(attendees(await fetchData())).toBe(2050);
  }, 120000);
});
