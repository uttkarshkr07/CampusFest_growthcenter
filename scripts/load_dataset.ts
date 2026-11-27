// Checks the dataset workbooks, and (only with --load) replaces one dataset with them.
//   npm run data:check                                  check the original's workbooks: changes nothing
//   npm run data:check -- --dataset simulated           check the simulated workbooks
//   npm run data:load -- --dataset original|simulated   check, ask you to confirm, then replace that dataset
//   add --folder "D:\path" after the -- to use another folder
//   (defaults: ../dataset for the original, ../dataset/simulated for the simulated data)
// Needs .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local only) to load.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ATTENDEE, checkDataset, type CheckResult, type Converted } from "../lib/data/checks";
import { convertTable } from "../lib/data/convert";
import { BASE_MB, estimateSize } from "../lib/data/size";
import { DATASET_LABEL, isDatasetId, rpcName, stagingName, tableName, type DatasetId } from "../lib/datasets";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const load = args.includes("--load");
const BATCH = 2000;
const BET_FILE = "Bet Dataset.xlsx";

function stop(message: string): never {
  console.error(`\nSTOP: ${message}`);
  process.exit(1);
}

const asked = option("--dataset");
if (asked !== undefined && !isDatasetId(asked)) stop(`--dataset must be original or simulated, not "${asked}".`);
// a load has to name its dataset, so one set of files cannot replace the other by accident
if (load && !asked) stop("Say which dataset to replace:  npm run data:load -- --dataset original   (or simulated)");
const dataset: DatasetId = isDatasetId(asked) ? asked : "original";
const folder = path.resolve(root, option("--folder") ?? (dataset === "simulated" ? "../dataset/simulated" : "../dataset"));

const hasBetFile = existsSync(path.join(folder, BET_FILE));
if (dataset === "original" && hasBetFile) stop(`${folder} holds "${BET_FILE}", so these are simulated workbooks. They are not loaded as the original. Use --dataset simulated.`);
if (dataset === "simulated" && !hasBetFile) stop(`${folder} has no "${BET_FILE}". The simulated dataset needs it (see DATA_GUIDE.md).`);

/** ids stay the same from one load to the next, so links to a ticket keep working */
function ticketId(key: string): string {
  if (key === "TK001") return "00000000-0000-4000-8000-000000000001";
  const h = createHash("sha1").update(`cfgc-ticket:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function convert(): Converted {
  const work = mkdtempSync(path.join(tmpdir(), "cfgc-load-"));
  const out = path.join(work, "dataset.json");
  console.log(`Dataset: ${DATASET_LABEL[dataset]}\nReading the workbooks in ${folder} ...`);
  // -I: the workbooks' folder is never used as a place to load Python code from
  const run = spawnSync("python", ["-I", path.join(root, "scripts", "dataset_to_json.py"), folder, out, dataset], { cwd: root, stdio: "inherit" });
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

const seedFile = (table: string) => path.join(root, "data", "seed", `${table}.json`);
const seedRows = (table: string) => JSON.parse(readFileSync(seedFile(table), "utf8")) as Record<string, unknown>[];

/** the original is meant to stay the brief's data: say which tables differ from the copy in data/seed */
function differsFromBrief(r: CheckResult): string[] {
  return Object.entries(ATTENDEE)
    .filter(([table, spec]) => {
      const brief = convertTable(spec, seedRows(table), [], []);
      return JSON.stringify(brief) !== JSON.stringify(r.originals[`original_${table}`] ?? []);
    })
    .map(([table]) => table);
}

function sizes(r: CheckResult) {
  const mine = estimateSize(r.counts);
  console.log(`\nEstimated database size (both copies, with indexes; an estimate, not a measurement):`);
  console.log(`  ${DATASET_LABEL[dataset].padEnd(30)} ${mine.rows.toLocaleString("en-IN").padStart(9)} rows  ${mine.datasetMb.toFixed(0).padStart(4)} MB`);
  let total = BASE_MB + mine.datasetMb;
  if (dataset === "simulated") {
    const brief = estimateSize(Object.fromEntries(Object.keys(ATTENDEE).map((t) => [`original_${t}`, seedRows(t).length])));
    console.log(`  ${DATASET_LABEL.original.padEnd(30)} ${brief.rows.toLocaleString("en-IN").padStart(9)} rows  ${brief.datasetMb.toFixed(0).padStart(4)} MB`);
    total += brief.datasetMb;
    console.log(`  Both datasets with the empty database: about ${total.toFixed(0)} MB of the free plan's 500 MB;`);
  } else console.log(`  With the empty database: about ${total.toFixed(0)} MB of the free plan's 500 MB, plus the simulated data if loaded;`);
  console.log(`  up to about ${(total + mine.switchExtraMb).toFixed(0)} MB while a load or reset is switching over.`);
  if (total + mine.switchExtraMb > 450) console.log("  WARNING: close to the limit. Reduce interaction rows per person first (the largest table).");
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
  if (dataset === "simulated") {
    const patched = await db.rpc("sim_dataset_status");
    if (patched.error) stop(`The database has no simulated tables yet (${patched.error.message}). Run supabase/patch_session4_datasets.sql first.`);
  }

  const phrase = `REPLACE ${dataset.toUpperCase()}`;
  console.log(`\nThis REPLACES the live "${DATASET_LABEL[dataset]}" and leaves the other dataset alone. When it finishes, its edits made in the app,\ntasks, tickets and ticket comments are gone, and the app shows what is in these workbooks. Copilot chats are kept.\nDatabase now: ${(Number(size.data) / 1048576).toFixed(0)} MB of the free plan's 500 MB.`);
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask.question(`Type ${phrase} to continue, or press Enter to stop: `);
  ask.close();
  if (answer.trim() !== phrase) stop("Nothing was changed.");

  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
  const call = async (what: string, run: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>) => {
    const res = await run();
    if (res.error) stop(`${what}: ${res.error.message}\nThe app still shows the old data. Fix the problem and run the load again (reset is blocked until a load finishes).`);
    return res.data;
  };
  await call("Starting the load", () => db.rpc(rpcName(dataset, "prepare_data_load")));

  const countOf = async (table: string) => {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    return error ? -1 : (count ?? 0);
  };
  for (const [key, rows] of Object.entries(r.originals)) {
    const short = key.replace(/^original_/, "");
    const table = stagingName(dataset, short);
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
      process.stdout.write(`\r  ${short.padEnd(22)} ${Math.min(rows.length, i + BATCH).toLocaleString("en-IN")} / ${rows.length.toLocaleString("en-IN")}   `);
    }
    process.stdout.write("\n");
  }

  for (const [sheet, rows] of Object.entries(r.sponsor)) {
    await call(`Loading sponsor ${sheet}`, () => db.from(tableName(dataset, "sponsor_data")).upsert({ sheet, rows, loaded_at: new Date().toISOString() }));
    console.log(`  sponsor ${sheet.padEnd(14)} ${rows.length.toLocaleString("en-IN")}`);
  }

  console.log("Switching the app to the new data (this can take up to a minute) ...");
  const expected = Object.fromEntries(Object.entries(r.counts).map(([key, n]) => [stagingName(dataset, key.replace(/^original_/, "")), n]));
  await call("Switching over", () => db.rpc(rpcName(dataset, "finish_data_load"), { p_expected: expected }));

  const after = await db.rpc("db_size_bytes");
  const started = Date.now();
  const check = await db.rpc(rpcName(dataset, "get_app_data"));
  console.log(`\nDone. Database size: ${(Number(after.data) / 1048576).toFixed(0)} MB of 500 MB.`);
  if (check.error) console.log(`The app's first request failed when tried here: ${check.error.message}`);
  else console.log(`The app's first request took ${((Date.now() - started) / 1000).toFixed(1)} s from this computer. Open the site and reload it.`);
  console.log("Next: node scripts/setup_logins.mjs --check-only --expect-locked");
}

const accounts = JSON.parse(readFileSync(path.join(root, "lib", "auth", "accounts.json"), "utf8")) as { personId: string | null }[];
const result = checkDataset(convert(), { accountOwnerIds: accounts.map((a) => a.personId).filter((x): x is string => !!x), ticketId, dataset });
report(result);
sizes(result);
if (dataset === "original") {
  const changed = differsFromBrief(result);
  console.log(changed.length ? `\nNOTE: these workbooks differ from the brief's 2025 data (data/seed) in: ${changed.join(", ")}.\nThe original dataset is the one graders are told is the brief's data.` : "\nThese workbooks match the brief's 2025 data (data/seed).");
}
if (result.errors.length) stop(`${result.errors.length} problem(s) must be fixed. Nothing was changed.`);
if (!load) console.log(`\nCheck only: nothing was changed. To load these files:  npm run data:load -- --dataset ${dataset}`);
else await replace(result);
