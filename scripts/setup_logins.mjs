// Creates the demo accounts, then checks what each one can and cannot do.
// Run from the app folder, AFTER supabase/patch_session3a.sql:
//   node scripts/setup_logins.mjs                 create or update accounts, then check
//   node scripts/setup_logins.mjs --check-only    check only (use after part B, with --expect-locked)
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (local only) and NEXT_PUBLIC_DEMO_PASSWORD. It prints no passwords or keys.
//
// The checks are safe for your data: "can edit" is tested by saving a value back unchanged, and the
// temporary tasks and chat it creates are removed. One check per dataset asks a non-reviewer to reset
// it and expects a refusal; if that rule were broken, the reset would run and clear edits and tasks.
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

// tickets: all changes go through database functions that check the team, the status step and the date.
// Every attempt below uses a temporary ticket, never the sample one, so a broken rule cannot change it.
const TEMP_TICKET = "ROLE CHECK (temporary)";
const ticketTable = await admin.from("tickets").select("id", { count: "exact", head: true });
const hasTickets = !ticketTable.error;
if (!hasTickets) console.log("Ticket tables not created yet: their checks are skipped.");
else if (clients.reviewer && clients.meera && clients.arjun && clients.riya && clients.dev) {
  const { reviewer, meera, arjun, riya, dev } = clients;
  await admin.from("tickets").delete().eq("title", TEMP_TICKET);
  for (const [name, db] of [["Reviewer", reviewer], ["Dev", dev]]) {
    const read = await db.from("tickets").select("id");
    check(!read.error, `${name}: can read tickets (${read.error?.message})`);
  }
  const direct = await reviewer.from("tickets").insert({ title: TEMP_TICKET, from_team: "sponsorship", to_team: "publicity", raised_on: "2025-04-19" }).select("id");
  check(!!direct.error, "Reviewer: must not write the ticket table directly");
  const raise = (db, from) => db.rpc("raise_ticket", { p_title: TEMP_TICKET, p_details: "", p_from: from, p_to: from === "publicity" ? "events" : "publicity", p_priority: "low", p_needed_by: null, p_assignee: null, p_on: "2025-04-19" });
  const wrongTeam = await raise(arjun, "sponsorship");
  check(!!wrongTeam.error, "Arjun: must not raise a ticket for sponsorship");
  const made = await raise(riya, "sponsorship");
  check(!made.error && !!made.data, `Riya: can raise a sponsorship ticket (${made.error?.message})`);
  if (made.data) {
    const id = made.data;
    const move = (db, status, on = "2025-04-19") => db.rpc("move_ticket", { p_id: id, p_status: status, p_note: null, p_on: on });
    const directMove = await meera.from("tickets").update({ status: "done" }).eq("id", id).select("id");
    check(!!directMove.error || directMove.data.length === 0, "Meera: must not change a ticket directly");
    check(!!(await move(dev, "accepted")).error, "Dev: must not answer a ticket sent to publicity");
    check(!!(await move(clients.kabir ?? dev, "accepted")).error, "Kabir (sender's team only): must not answer it");
    check(!!(await move(arjun, "done")).error, "Arjun: an open ticket cannot jump to done");
    check(!!(await move(arjun, "accepted", "2025-04-18")).error, "Arjun: cannot answer before the ticket was raised");
    const ok = await move(arjun, "accepted");
    check(!ok.error, `Arjun: can accept a publicity ticket (${ok.error?.message})`);
    const said = await dev.rpc("comment_ticket", { p_id: id, p_body: "role check", p_on: "2025-04-19" });
    check(!said.error, `Dev: can comment on any ticket (${said.error?.message})`);
    const edit = (db) => db.rpc("edit_ticket", { p_id: id, p_title: TEMP_TICKET, p_details: "edited", p_priority: "low", p_needed_by: null, p_on: "2025-04-19" });
    check(!!(await edit(arjun)).error, "Arjun: must not edit another team's request");
    const own = await edit(riya);
    check(!own.error, `Riya: can edit her team's request (${own.error?.message})`);
    const outsider = await createClient(url, anonKey, noSession).rpc("comment_ticket", { p_id: id, p_body: "x", p_on: "2025-04-19" });
    check(!!outsider.error, "Not signed in: cannot comment on a ticket");
  }
  await admin.from("tickets").delete().eq("title", TEMP_TICKET);
}

// paged loading and the load commands (present after the large-data patch)
const paged = await admin.rpc("get_app_data");
const hasPaged = !paged.error;
if (!hasPaged) console.log("Large-data patch not run yet: its checks are skipped.");
else if (clients.reviewer && clients.dev) {
  for (const [name, db] of [["Reviewer", clients.reviewer], ["Dev", clients.dev]]) {
    const head = await db.rpc("get_app_data");
    check(!head.error && head.data?.ranges?.people?.[2] > 0, `${name}: can load the app data (${head.error?.message ?? "empty"})`);
    const from = head.data?.ranges?.people?.[0] ?? 1;
    const page = await db.rpc("get_rows", { p_table: "people", p_from: from, p_to: from + 9 });
    check(!page.error && page.data?.rows?.length > 0 && page.data.cols.includes("person_id"), `${name}: can load a page of rows (${page.error?.message ?? "empty"})`);
    const originals = await db.from("original_tickets").select("ticket_key").limit(1);
    check(!!originals.error || originals.data.length === 0, `${name}: must not read the original tables`);
  }
  // asked only as a non-service account: it must be refused, so nothing is emptied
  const wipe = await clients.dev.rpc("prepare_data_load");
  check(!!wipe.error, "Dev: must not be able to start a data load");
}

// the simulated dataset (patch_session4_datasets.sql): the same rules on its own tables
const simStatus = await admin.rpc("sim_dataset_status");
const hasSim = !simStatus.error;
if (!hasSim) console.log("Two-dataset patch not run yet: its checks are skipped.");
else if (clients.reviewer && clients.dev) {
  const newTables = ["colleges", "contingents", "contingent_tier_events", "squads", "passes", "payments", "perk_grants", "insurance_claims",
    "venues", "program_events", "seat_booking_history", "seat_scans", "waitlist_entries", "exchange_offers", "competition_results",
    "hackathon_teams", "hackathon_members", "bets", "bet_thresholds", "bet_milestones", "bet_spend"];
  for (const [name, db] of [["Reviewer", clients.reviewer], ["Dev", clients.dev]]) {
    for (const t of [...newTables.map((t) => `sim_${t}`), "venues", "program_events"]) {
      const read = await db.from(t).select("_row_id").limit(1);
      check(!read.error, `${name}: can read ${t} (${read.error?.message})`);
    }
    for (const t of ["sim_original_passes", "sim_original_people", "sim_original_tickets"]) {
      const peek = await db.from(t).select("*").limit(1);
      check(!!peek.error || peek.data.length === 0, `${name}: must not read ${t}`);
    }
    const head = await db.rpc("sim_get_app_data");
    check(!head.error && !!head.data?.ranges, `${name}: can load the simulated app data (${head.error?.message ?? "empty"})`);
  }
  // view only: even the Reviewer may not add a row (the temporary row is removed if the rule is broken)
  for (const t of ["sim_passes", "sim_payments", "sim_bets", "venues"]) {
    const added = await clients.reviewer.from(t).insert({ _source: "role check" }).select("_row_id");
    check(!!added.error, `Reviewer: must not add rows to ${t}`);
    if (!added.error) await admin.from(t).delete().eq("_source", "role check");
  }
  const wipeSim = await clients.dev.rpc("sim_prepare_data_load");
  check(!!wipeSim.error, "Dev: must not be able to start a simulated data load");
  const direct = await clients.reviewer.from("sim_tickets").insert({ title: "ROLE CHECK (temporary)", from_team: "sponsorship", to_team: "publicity", raised_on: "2025-04-19" }).select("id");
  check(!!direct.error, "Reviewer: must not write the simulated ticket table directly");

  const chat = crypto.randomUUID();
  const made = await clients.reviewer.from("chat_sessions").insert({ id: chat, title: "role check (temporary)", dataset: "simulated" });
  check(!made.error, `Reviewer: can create a chat about the simulated data (${made.error?.message})`);
  const listed = await clients.reviewer.from("chat_sessions").select("id").eq("dataset", "original").eq("id", chat);
  check(!listed.error && listed.data.length === 0, "Reviewer: a simulated chat is not listed with the original's chats");
  await clients.reviewer.from("chat_sessions").delete().eq("id", chat);

  if (simStatus.data !== true) console.log("Nothing is loaded into the simulated dataset yet: its edit, task and reset checks are skipped.");
  else {
    // "can edit" is tested by saving a value back unchanged
    for (const [table, key, column] of [["campaigns", "_row_id", "campaign_name"], ["checkins", "_row_id", "result"], ["people", "_row_id", "person_name"], ["settings", "key", "value"], ["bet_thresholds", "_row_id", "scale_at"]]) {
      const sample = await admin.from(`sim_${table}`).select(`${key}, ${column}`).order(key).limit(1);
      if (!sample.data?.length) continue;
      const row = sample.data[0];
      for (const a of accounts) {
        if (!clients[a.key]) continue;
        const res = await clients[a.key].from(`sim_${table}`).update({ [column]: row[column] }).eq(key, row[key]).select(key);
        const should = table === "bet_thresholds" ? a.reviewer || a.teams.includes("publicity") : mayEdit(a, table);
        check((!res.error && res.data.length === 1) === should, `${a.name}: sim_${table} edit should be ${should ? "allowed" : "blocked"}${res.error ? ` (${res.error.message})` : ""}`);
      }
    }
    for (const a of accounts) {
      if (!clients[a.key]) continue;
      const should = a.reviewer || a.teams.includes("publicity");
      const res = await clients[a.key].from("sim_tasks").insert({ title: "ROLE CHECK (temporary)", owner_id: taskOwners.publicity }).select("id");
      check((!res.error && res.data.length === 1) === should, `${a.name}: creating a simulated publicity task should be ${should ? "allowed" : "blocked"}${res.error ? ` (${res.error.message})` : ""}`);
    }
    await admin.from("sim_tasks").delete().eq("title", "ROLE CHECK (temporary)");
    const refused = await clients.dev.rpc("sim_reset_demo");
    check(!!refused.error, "Dev: simulated reset must be refused (IT RAN: its edits and tasks were cleared)");
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
if (hasTickets) {
  const peekTickets = await visitor.from("tickets").select("id");
  check(!!peekTickets.error || peekTickets.data.length === 0, "Not signed in: cannot read tickets");
}
if (hasPaged) {
  check(!!(await visitor.rpc("get_app_data")).error, "Not signed in: cannot load the app data");
  check(!!(await visitor.rpc("get_rows", { p_table: "people", p_from: 1, p_to: 10 })).error, "Not signed in: cannot load rows");
}
if (hasSim) {
  for (const t of ["sim_people", "sim_passes", "sim_tickets", "venues"]) {
    const peek = await visitor.from(t).select("*").limit(1);
    check(!!peek.error || peek.data.length === 0, `Not signed in: cannot read ${t}`);
  }
  check(!!(await visitor.rpc("sim_get_app_data")).error, "Not signed in: cannot load the simulated data");
  check(!!(await visitor.rpc("sim_get_rows", { p_table: "people", p_from: 1, p_to: 10 })).error, "Not signed in: cannot load simulated rows");
}
if (expectLocked) check(locked, "Not signed in: get_dataset must be refused (has part B been run?)");

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
for (const f of failures) console.log(`  FAILED ${f}`);
console.log(locked ? "Visitors who are not signed in: BLOCKED." : "Visitors who are not signed in: still OPEN (expected until part B is run).");
process.exit(failures.length ? 1 : 0);
