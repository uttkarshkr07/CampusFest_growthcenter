// Checks the dataset workbooks, and (only with --load) replaces the live data with them.
//   npm run data:check                      check only: changes nothing
//   npm run data:load                       check, ask you to type REPLACE, then load
//   add  -- --folder "D:\path"              to use another folder (default: ../dataset)
// Needs .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local only) to load.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { checkDataset, type CheckResult, type Converted } from "../lib/data/checks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const load = args.includes("--load");
const folder = path.resolve(root, option("--folder") ?? "../dataset");
const BATCH = 2000;

function stop(message: string): never {
  console.error(`\nSTOP: ${message}`);
  process.exit(1);
}

/** ids stay the same from one load to the next, so links to a ticket keep working */
function ticketId(key: string): string {
  if (key === "TK001") return "00000000-0000-4000-8000-000000000001";
  const h = createHash("sha1").update(`cfgc-ticket:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function convert(): Converted {
  const work = mkdtempSync(path.join(tmpdir(), "cfgc-load-"));
  const out = path.join(work, "dataset.json");
  console.log(`Reading the workbooks in ${folder} ...`);
  // -I: the workbooks' folder is never used as a place to load Python code from
  const run = spawnSync("python", ["-I", path.join(root, "scripts", "dataset_to_json.py"), folder, out], { cwd: root, stdio: "inherit" });
  if (run.status !== 0) stop("The workbooks could not be read (see the message above). Python with openpyxl is needed.");
  const parsed = JSON.parse(readFileSync(out, "utf8")) as Converted;
  rmSync(work, { recursive: true, force: true });
  return parsed;
}

const csv = (v: unknown) => {
  const s = String(v ?? "");
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

function report(r: CheckResult) {
  console.log("\nRows to load:");
  for (const [table, n] of Object.entries(r.counts)) console.log(`  ${table.replace("original_", "").padEnd(22)} ${n.toLocaleString("en-IN").padStart(9)}`);
  for (const [sheet, rows] of Object.entries(r.sponsor)) console.log(`  sponsor ${sheet.padEnd(14)} ${rows.length.toLocaleString("en-IN").padStart(9)}`);

  const show = (title: string, list: CheckResult["errors"]) => {
    if (!list.length) return;
    console.log(`\n${title} (${list.length}):`);
    for (const p of list.slice(0, 25)) console.log(`  ${p.sheet}${p.row ? `, row ${p.row}` : ""}: ${p.text}`);
    if (list.length > 25) console.log(`  ... and ${list.length - 25} more in the report file`);
  };
  show("MUST FIX before loading", r.errors);
  show("Warnings (will load)", r.warnings);
  if (r.issues.length) {
    console.log("\nProblem records (will load; the app treats them as described):");
    for (const i of r.issues) console.log(`  [${i.effect}] ${i.table}: ${i.title}: ${i.records.length} (e.g. ${i.records[0].row ? `row ${i.records[0].row}, ` : ""}${i.records[0].id}: ${i.records[0].detail})`);
  }

  const lines = [["Level", "Sheet or table", "Excel row", "Record", "Problem", "What happens"].map(csv).join(",")];
  for (const p of r.errors) lines.push(["MUST FIX", p.sheet, p.row, "", p.text, "The load stops"].map(csv).join(","));
  for (const p of r.warnings) lines.push(["warning", p.sheet, p.row, "", p.text, "Loads"].map(csv).join(","));
  for (const i of r.issues) for (const x of i.records) lines.push([i.effect, i.table, x.row, x.id, `${i.title}: ${x.detail}`, i.rule].map(csv).join(","));
  const file = path.join(folder, "check-report.csv");
  try {
    writeFileSync(file, "\uFEFF" + lines.join("\r\n"), "utf8");
    console.log(`\nFull report, one line per record: ${file}`);
  } catch {
    console.log(`\nThe report file could not be written (is it open in Excel?): ${file}`);
  }
}

function env(): { url: string; key: string } {
  const file = path.join(root, ".env.local");
  const values: Record<string, string> = {};
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  const url = values.NEXT_PUBLIC_SUPABASE_URL;
  const key = values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) stop("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed in .env.local.");
  return { url, key };
}

async function replace(r: CheckResult) {
  const { url, key } = env();
  const db = createClient(url, key, { auth: { persistSession: false } });
  const size = await db.rpc("db_size_bytes");
  if (size.error) stop(`The database is not ready for loading (${size.error.message}). Run supabase/patch_session3e_scale.sql first.`);

  console.log(`\nThis REPLACES the live data. When it finishes, edits made in the app, tasks, tickets and ticket comments are gone,\nand the app shows what is in these workbooks. Copilot chats are kept. Database now: ${(Number(size.data) / 1048576).toFixed(0)} MB of the free plan's 500 MB.`);
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask.question("Type REPLACE to continue, or press Enter to stop: ");
  ask.close();
  if (answer.trim() !== "REPLACE") stop("Nothing was changed.");

  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
  const call = async (what: string, run: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>) => {
    const res = await run();
    if (res.error) stop(`${what}: ${res.error.message}\nThe app still shows the old data. Fix the problem and run the load again (reset is blocked until a load finishes).`);
    return res.data;
  };
  await call("Starting the load", () => db.rpc("prepare_data_load"));

  const countOf = async (table: string) => {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    return error ? -1 : (count ?? 0);
  };
  for (const [table, rows] of Object.entries(r.originals)) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH);
      let sent = false;
      for (let attempt = 1; attempt <= 4 && !sent; attempt++) {
        const { error } = await db.from(table).insert(part);
        if (!error) sent = true;
        else {
          // a dropped reply can mean the rows did arrive: count before sending them again
          await wait(1500 * attempt);
          const now = await countOf(table);
          if (now === i + part.length) sent = true;
          else if ((now !== i && now !== -1) || attempt === 4) stop(`Loading ${table} failed at row ${i + 1}: ${error.message}\nThe app still shows the old data. Run the load again.`);
        }
      }
      process.stdout.write(`\r  ${table.replace("original_", "").padEnd(22)} ${Math.min(rows.length, i + BATCH).toLocaleString("en-IN")} / ${rows.length.toLocaleString("en-IN")}   `);
    }
    process.stdout.write("\n");
  }

  for (const [sheet, rows] of Object.entries(r.sponsor)) {
    await call(`Loading sponsor ${sheet}`, () => db.from("sponsor_data").upsert({ sheet, rows, loaded_at: new Date().toISOString() }));
    console.log(`  sponsor ${sheet.padEnd(14)} ${rows.length.toLocaleString("en-IN")}`);
  }

  console.log("Switching the app to the new data (this can take up to a minute) ...");
  await call("Switching over", () => db.rpc("finish_data_load", { p_expected: r.counts }));

  const after = await db.rpc("db_size_bytes");
  const started = Date.now();
  const check = await db.rpc("get_app_data");
  console.log(`\nDone. Database size: ${(Number(after.data) / 1048576).toFixed(0)} MB of 500 MB.`);
  if (check.error) console.log(`The app's first request failed when tried here: ${check.error.message}`);
  else console.log(`The app's first request took ${((Date.now() - started) / 1000).toFixed(1)} s from this computer. Open the site and reload it.`);
  console.log("Next: node scripts/setup_logins.mjs --check-only --expect-locked");
}

const accounts = JSON.parse(readFileSync(path.join(root, "lib", "auth", "accounts.json"), "utf8")) as { personId: string | null }[];
const result = checkDataset(convert(), { accountOwnerIds: accounts.map((a) => a.personId).filter((x): x is string => !!x), ticketId });
report(result);
if (result.errors.length) stop(`${result.errors.length} problem(s) must be fixed. Nothing was changed.`);
if (!load) console.log("\nCheck only: nothing was changed. To load these files:  npm run data:load");
else await replace(result);
