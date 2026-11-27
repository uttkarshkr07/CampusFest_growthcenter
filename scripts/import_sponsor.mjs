// Loads data/seed/sponsor.json into the sponsor_data table. It writes ONLY that table:
// attendee data, edits, tasks and chats are not touched, and nothing is reset.
// Usage (from the app folder):
//   python -I scripts/xlsx_to_json.py      (only to rebuild the JSON from the workbooks)
//   node scripts/import_sponsor.mjs
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (local only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const file = path.join(root, "data", "seed", "sponsor.json");
if (!fs.existsSync(file)) {
  console.error("data/seed/sponsor.json is missing. Run: python -I scripts/xlsx_to_json.py");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const { error } = await db.from("sponsor_data").upsert(Object.entries(data).map(([sheet, rows]) => ({ sheet, rows, loaded_at: new Date().toISOString() })));
if (error) {
  console.error(`Load failed: ${error.message}\nHas supabase/patch_session3c_sponsor.sql been run?`);
  process.exit(1);
}
const back = await db.from("sponsor_data").select("sheet, rows");
if (back.error) {
  console.error(`Could not read the table back: ${back.error.message}`);
  process.exit(1);
}
let bad = 0;
for (const [sheet, rows] of Object.entries(data)) {
  const stored = back.data.find((r) => r.sheet === sheet)?.rows.length ?? 0;
  if (stored !== rows.length) bad++;
  console.log(`${sheet.padEnd(20)} file ${String(rows.length).padStart(5)}  database ${String(stored).padStart(5)}  ${stored === rows.length ? "OK" : "MISMATCH"}`);
}
console.log(bad ? `${bad} sheet(s) do not match.` : "Sponsor records loaded. Attendee data, edits, tasks and chats were not touched.");
process.exit(bad ? 1 : 0);
