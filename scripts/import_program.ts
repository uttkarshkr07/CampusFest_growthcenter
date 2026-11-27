// Puts the festival program (venues and events) beside the ORIGINAL dataset, read only, so the campus
// map can show it there. It replaces the two tables venues and program_events and touches nothing else:
// no edit, task or ticket is reset. The simulated dataset gets its program from Bet Dataset.xlsx.
//   npm run data:program                     reads ../program/CampusFest_2025_program.xlsx
//   npm run data:program -- --check          reads and checks only
//   needs .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { BET_TABLES, PROGRAM_TABLES } from "../lib/data/bet-spec";
import { convertTable, type Problem, type Row } from "../lib/data/convert";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workbook = path.resolve(root, "../program/CampusFest_2025_program.xlsx");
const checkOnly = process.argv.includes("--check");

function stop(message: string): never {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), "cfgc-program-"));
const out = path.join(work, "program.json");
const run = spawnSync("python", ["-I", path.join(root, "scripts", "dataset_to_json.py"), "--program", workbook, out], { cwd: root, stdio: "inherit" });
if (run.status !== 0) stop("The program workbook could not be read. Python with openpyxl is needed.");
const parsed = JSON.parse(readFileSync(out, "utf8")) as { headers: Record<string, string[]>; problems: Problem[]; bets: Record<string, Row[]> };
rmSync(work, { recursive: true, force: true });

const errors: Problem[] = [...parsed.problems];
const warnings: Problem[] = [];
const rows = Object.fromEntries(
  PROGRAM_TABLES.map((table) => {
    const missing = Object.keys(BET_TABLES[table].columns).filter((c) => !parsed.headers[`bets.${table}`]?.includes(c));
    if (missing.length) errors.push({ sheet: table, text: `Missing column(s): ${missing.join(", ")}` });
    return [table, convertTable(BET_TABLES[table], parsed.bets[table] ?? [], errors, warnings)];
  }),
);
for (const p of [...errors, ...warnings]) console.log(`  ${p.sheet}${p.row ? `, row ${p.row}` : ""}: ${p.text}`);
if (errors.length) stop("Nothing was changed.");
for (const table of PROGRAM_TABLES) console.log(`  ${table}: ${rows[table].length} rows`);
if (checkOnly) {
  console.log("Check only: nothing was changed.");
  process.exit(0);
}

const values: Record<string, string> = {};
const envFile = path.join(root, ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.SUPABASE_SERVICE_ROLE_KEY) stop("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed in .env.local.");
const db = createClient(values.NEXT_PUBLIC_SUPABASE_URL, values.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

for (const table of PROGRAM_TABLES) {
  const cleared = await db.from(table).delete().gte("_row_id", 0);
  if (cleared.error) stop(`${table}: ${cleared.error.message} (has supabase/patch_session4_datasets.sql been run?)`);
  const added = await db.from(table).insert(rows[table]);
  if (added.error) stop(`${table}: ${added.error.message}. Run the command again.`);
}
console.log("Done. Only venues and program_events were replaced.");
