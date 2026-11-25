// Loads data/seed/*.json into the pristine original_* tables, then calls reset_demo()
// to copy them into the working tables and seed app defaults.
// Usage (from the app folder): node scripts/import.mjs
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (local only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const TABLES = ["event", "targets", "campaigns", "daily_marketing", "people", "interactions", "registrations", "registration_history", "checkins", "sponsor_activations"];
const EXPECTED = { daily_marketing: 483, people: 3685, interactions: 11650, registrations: 2840, registration_history: 5911, checkins: 3390 };

for (const t of TABLES) {
  const rows = JSON.parse(fs.readFileSync(path.join(root, "data", "seed", `${t}.json`), "utf8"));
  const { error: delErr } = await db.from(`original_${t}`).delete().gte("_row_id", 0);
  if (delErr) throw new Error(`clear original_${t}: ${delErr.message}`);
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from(`original_${t}`).insert(rows.slice(i, i + 1000));
    if (error) throw new Error(`insert original_${t} batch ${i}: ${error.message}`);
  }
  const { count } = await db.from(`original_${t}`).select("*", { count: "exact", head: true });
  const exp = EXPECTED[t];
  console.log(`${t.padEnd(22)} seed ${String(rows.length).padStart(6)}  db ${String(count).padStart(6)}${exp ? (count === exp ? "  OK" : `  MISMATCH (expected ${exp})`) : ""}`);
}

const { data, error } = await db.rpc("reset_demo");
if (error) throw new Error(`reset_demo: ${error.message}`);
console.log("reset_demo working-table counts:", data);
