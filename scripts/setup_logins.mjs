// Creates the demo accounts, then checks what each one can and cannot do.
// Run from the app folder, AFTER supabase/patch_session3a.sql:
//   node scripts/setup_logins.mjs                 create or update accounts, then check
//   node scripts/setup_logins.mjs --check-only    check only (use after part B, with --expect-locked)
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (local only) and NEXT_PUBLIC_DEMO_PASSWORD. It prints no passwords or keys.
//
// The checks are safe for your data: "can edit" is tested by saving a value back unchanged, and the
// temporary tasks and chat it creates are removed. One check asks a non-reviewer to reset the demo
// and expects a refusal; if that rule were broken, the reset would run and clear edits and tasks.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey, NEXT_PUBLIC_DEMO_PASSWORD: password } = process.env;
const stop = (msg) => {
  console.error(`STOP: ${msg}`);
  process.exit(1);
};
if (!url || !anonKey || !serviceKey) stop("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.");
if (!password || password.length < 10) stop("Add NEXT_PUBLIC_DEMO_PASSWORD (10 or more characters, used nowhere else) to .env.local. It will be visible inside the shipped app.");

const accounts = JSON.parse(fs.readFileSync(path.join(root, "lib", "auth", "accounts.json"), "utf8"));
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);
const checkOnly = process.argv.includes("--check-only");
const expectLocked = process.argv.includes("--expect-locked");

const probe = await admin.from("profiles").select("user_id").limit(1);
if (probe.error) stop(`The profiles table is not there (${probe.error.message}). Run supabase/patch_session3a.sql first.`);

if (!checkOnly) {
  const existing = await admin.auth.admin.listUsers({ perPage: 200 });
  if (existing.error) stop(`Could not list users: ${existing.error.message}`);
  for (const a of accounts) {
    let user = existing.data.users.find((u) => u.email === a.email);
    const res = user
      ? await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true })
      : await admin.auth.admin.createUser({ email: a.email, password, email_confirm: true });
    if (res.error) stop(`${a.name}: ${res.error.message}`);
    const verb = user ? "updated" : "created";
    user = res.data.user;
    const p = await admin.from("profiles").upsert({ user_id: user.id, person_id: a.personId, display_name: a.name, is_reviewer: a.reviewer });
    if (p.error) stop(`${a.name} profile: ${p.error.message}`);
    const d = await admin.from("memberships").delete().eq("user_id", user.id);
    if (d.error) stop(`${a.name} teams: ${d.error.message}`);
    if (a.teams.length) {
      const m = await admin.from("memberships").insert(a.teams.map((team) => ({ user_id: user.id, team })));
      if (m.error) stop(`${a.name} teams: ${m.error.message}`);
    }
    console.log(`account ${verb}: ${a.name}`);
  }
}

// ---------------------------------------------------------------------------
// Checks. The expected rules are written out again here on purpose, so a mistake
// in the app's copy cannot also hide it from this check.
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
const check = (ok, label) => (ok ? passed++ : failures.push(label));

const samples = {};
for (const [table, key, column] of [
  ["campaigns", "_row_id", "campaign_name"],
  ["daily_marketing", "_row_id", "platform"],
  ["targets", "_row_id", "target_version"],
  ["campaign_plan", "campaign_id", "app_status"],
  ["settings", "key", "value"],
  ["checkins", "_row_id", "result"],
  ["people", "_row_id", "person_name"],
]) {
  const { data, error } = await admin.from(table).select(`${key}, ${column}`).order(key).limit(1);
  if (error || !data?.length) stop(`Could not read a sample row from ${table}: ${error?.message ?? "no rows"}`);
  samples[table] = { key, column, id: data[0][key], value: data[0][column] };
}
const publicityTables = ["campaigns", "daily_marketing", "targets", "campaign_plan", "settings"];
const mayEdit = (a, table) => a.reviewer || (publicityTables.includes(table) && a.teams.includes("publicity")) || (table === "checkins" && a.teams.includes("events"));
const taskOwners = { publicity: "T03", sponsorship: "T01", events: "T06" };

const clients = {};
for (const a of accounts) {
  const db = createClient(url, anonKey, noSession);
  const signed = await db.auth.signInWithPassword({ email: a.email, password });
  check(!signed.error, `${a.name}: sign-in (${signed.error?.message})`);
  if (signed.error) continue;
  clients[a.key] = db;

  const ds = await db.rpc("get_dataset");
  check(!ds.error && ds.data?.people?.length > 3000, `${a.name}: loads the dataset (${ds.error?.message ?? "too few rows"})`);
  const own = await db.from("profiles").select("display_name");
  check(own.data?.length === 1 && own.data[0].display_name === a.name, `${a.name}: sees only their own profile`);

  for (const [table, s] of Object.entries(samples)) {
    const res = await db.from(table).update({ [s.column]: s.value }).eq(s.key, s.id).select(s.key);
    const allowed = !res.error && res.data.length === 1;
    check(allowed === mayEdit(a, table), `${a.name}: ${table} edit should be ${mayEdit(a, table) ? "allowed" : "blocked"}${res.error ? ` (${res.error.message})` : ""}`);
  }
  for (const [team, owner] of Object.entries(taskOwners)) {
    const should = a.reviewer || a.teams.includes(team);
    const res = await db.from("tasks").insert({ title: "ROLE CHECK (temporary)", owner_id: owner }).select("id");
    const allowed = !res.error && res.data.length === 1;
    check(allowed === should, `${a.name}: creating a ${team} task should be ${should ? "allowed" : "blocked"}${res.error ? ` (${res.error.message})` : ""}`);
    if (allowed) await admin.from("tasks").delete().eq("id", res.data[0].id);
  }
}
await admin.from("tasks").delete().eq("title", "ROLE CHECK (temporary)");

if (clients.dev) {
  const r = await clients.dev.rpc("reset_demo");
  check(!!r.error, "Dev: reset must be refused (IT RAN: edits and tasks were cleared)");
}

if (clients.reviewer && clients.arjun) {
  const id = crypto.randomUUID();
  const made = await clients.reviewer.from("chat_sessions").insert({ id, title: "role check (temporary)" });
  check(!made.error, `Reviewer: can create a chat (${made.error?.message})`);
  const peek = await clients.arjun.from("chat_sessions").select("id").eq("id", id);
  check(!peek.error && peek.data.length === 0, "Arjun: cannot see the Reviewer's chat");
  const inject = await clients.arjun.from("chat_messages").insert({ id: crypto.randomUUID(), session_id: id, as_of: "2025-03-15", body: {} });
  check(!!inject.error, "Arjun: cannot write into the Reviewer's chat");
  await clients.reviewer.from("chat_sessions").delete().eq("id", id);
}

// sponsor records: members read, nobody writes from the app
const sponsorTable = await admin.from("sponsor_data").select("sheet", { count: "exact", head: true });
const hasSponsor = !sponsorTable.error;
if (!hasSponsor) console.log("Sponsor table not created yet: its checks are skipped.");
else {
  for (const key of ["reviewer", "dev"]) {
    const db = clients[key];
    if (!db) continue;
    const read = await db.from("sponsor_data").select("sheet");
    check(!read.error, `${key}: can read sponsor records (${read.error?.message})`);
    const write = await db.from("sponsor_data").update({ sheet: "targets" }).eq("sheet", "targets").select("sheet");
    check(!!write.error || write.data.length === 0, `${key}: must not be able to change sponsor records`);
  }
}

const visitor = createClient(url, anonKey, noSession);
const open = await visitor.rpc("get_dataset");
const locked = !!open.error;
if (locked) {
  const read = await visitor.from("people").select("_row_id").limit(1);
  check(!!read.error || read.data.length === 0, "Not signed in: cannot read tables");
  const s = samples.campaigns;
  const write = await visitor.from("campaigns").update({ [s.column]: s.value }).eq(s.key, s.id).select(s.key);
  check(!!write.error || write.data.length === 0, "Not signed in: cannot edit");
}
if (hasSponsor) {
  const peekSponsor = await visitor.from("sponsor_data").select("sheet");
  check(!!peekSponsor.error || peekSponsor.data.length === 0, "Not signed in: cannot read sponsor records");
}
if (expectLocked) check(locked, "Not signed in: get_dataset must be refused (has part B been run?)");

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
for (const f of failures) console.log(`  FAILED ${f}`);
console.log(locked ? "Visitors who are not signed in: BLOCKED." : "Visitors who are not signed in: still OPEN (expected until part B is run).");
process.exit(failures.length ? 1 : 0);
