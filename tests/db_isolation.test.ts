// Runs the real SQL files on an in-memory Postgres (PGlite) and checks that the two datasets never
// touch each other. Supabase's own parts (the auth schema, the roles, its default grants) are stood in
// for below, so this does not replace the role check on the real database.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { BET_TABLES, BET_TABLE_NAMES, PAGED_BET_TABLES } from "@/lib/data/bet-spec";

const sql = (file: string) => readFileSync(`supabase/${file}`, "utf8");

const SUPABASE_STAND_IN = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('role', current_setting('request.jwt.claim.role', true)) $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role authenticator nologin;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase grants new tables, sequences and functions to these roles by default
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const USERS = {
  reviewer: { id: "00000000-0000-0000-0000-0000000000a1", name: "Reviewer", person: null, teams: [] as string[], isReviewer: true },
  meera: { id: "00000000-0000-0000-0000-0000000000a2", name: "Meera", person: "T03", teams: ["publicity"], isReviewer: false },
  dev: { id: "00000000-0000-0000-0000-0000000000a3", name: "Dev", person: "T06", teams: ["events"], isReviewer: false },
};
type Who = keyof typeof USERS;

let db: PGlite;

/** run as a signed-in account, with row rules applied */
async function as<T = Record<string, unknown>>(who: Who | "anon" | "service", query: string, params: unknown[] = []): Promise<T[]> {
  const user = who === "anon" || who === "service" ? null : USERS[who];
  const role = who === "anon" ? "anon" : who === "service" ? "service_role" : "authenticated";
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [user?.id ?? "", role]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows as T[];
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)");
  }
}
const count = async (table: string, where = "true") => Number((await db.query<{ n: number }>(`select count(*)::int n from public.${table} where ${where}`)).rows[0].n);
const value = async (query: string) => Object.values((await db.query<Record<string, unknown>>(query)).rows[0] ?? {})[0];

const SOURCE = ["event", "targets", "campaigns", "daily_marketing", "people", "interactions", "registrations", "registration_history", "checkins", "sponsor_activations"];

/** a very small dataset in one set of staging tables */
async function stage(prefix: "" | "sim_", checkins: number) {
  const o = `public.${prefix}original_`;
  await db.exec(`
    insert into ${o}event (event_name, history_start, history_end, event_starts_at, event_ends_at) values ('Fest ${prefix}', '2025-01-15', '2025-04-20', '2025-04-12T10:00+05:30', '2025-04-13T20:00+05:30');
    insert into ${o}campaigns (campaign_id, campaign_name) values ('C01', 'Ambassadors ${prefix}');
    insert into ${o}people (person_id, person_name, person_type) values ('P1', 'Asha', 'external'), ('P2', 'Bilal', 'external');
    insert into ${o}registrations (registration_id, person_id, campaign_id) values ('R1', 'P1', 'C01');
    insert into ${o}checkins (event_id, person_id, result, verification) select 'CHK' || i, 'P' || i, 'admitted', 'verified' from generate_series(1, ${checkins}) i;
    insert into ${o}team (owner_id, owner_name, team) values ('T01', 'Riya', 'sponsorship'), ('T03', 'Meera', 'publicity'), ('T06', 'Dev', 'events') on conflict do nothing;
    insert into ${o}settings (key, value) values ('min_sample', '30') on conflict do nothing;
    insert into ${o}tickets (ticket_key, id, title, from_team, to_team, requester_id, assignee_id, raised_on) values ('TK001', '00000000-0000-4000-8000-000000000001', 'Sample ${prefix}', 'sponsorship', 'publicity', 'T01', 'T03', '2025-03-15') on conflict do nothing;
  `);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STAND_IN);
  await db.exec(sql("schema.sql")); // safe here: this database lives only in memory
  await db.exec(sql("patch_session3a.sql"));
  for (const u of Object.values(USERS)) {
    await db.query("insert into auth.users (id) values ($1)", [u.id]);
    await db.query("insert into public.profiles (user_id, person_id, display_name, is_reviewer) values ($1, $2, $3, $4)", [u.id, u.person, u.name, u.isReviewer]);
    for (const team of u.teams) await db.query("insert into public.memberships (user_id, team) values ($1, $2)", [u.id, team]);
  }
  // the service role has full table rights on Supabase
  await db.exec("grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;");
  for (const f of ["patch_session3b.sql", "patch_session3c_sponsor.sql", "patch_session3d_tickets.sql", "patch_session3e_scale.sql"]) await db.exec(sql(f));
  // a chat from before the patch
  await db.query("insert into public.chat_sessions (id, user_id, title) values ($1, $2, 'old chat')", ["10000000-0000-0000-0000-000000000001", USERS.reviewer.id]);
  await db.exec(sql("patch_session4_datasets.sql"));
  await db.exec(sql("patch_session4_datasets.sql")); // safe to run again

  await db.exec("truncate public.original_tickets");
  await stage("", 2);
  await as("service", "select public.finish_data_load($1)", [JSON.stringify({ original_people: 2, original_checkins: 2 })]);
}, 120000);

describe("simulated dataset: before and after its first load", () => {
  it("starts empty and says so", async () => {
    expect(await as("reviewer", "select public.sim_dataset_status() ready")).toEqual([{ ready: false }]);
    expect(await count("sim_checkins")).toBe(0);
  });

  it("a load switches only the simulated tables, and checks the row counts first", async () => {
    const before = await value("select count(*) from public.checkins");
    await as("service", "select public.sim_prepare_data_load()");
    expect(await count("original_checkins")).toBe(2);
    await expect(as("reviewer", "select public.sim_reset_demo()")).rejects.toThrow(/did not finish/);
    await as("reviewer", "select public.reset_demo()"); // the original is not blocked
    await stage("sim_", 1);
    await db.exec(`insert into public.sim_original_squads (squad_id) values ('S1');
      insert into public.sim_original_passes (pass_id, person_id, price_inr, booked_at) values ('X1', 'P1', 500, '2025-03-01T10:00+05:30'), ('X2', 'P2', 500, null);
      insert into public.sim_original_bet_thresholds (threshold_id, kpi_id, scale_at) values ('TH1', 'K02', 45);`);
    await expect(as("service", "select public.sim_finish_data_load($1)", [JSON.stringify({ sim_original_passes: 9 })])).rejects.toThrow(/Nothing was switched/);
    expect(await count("sim_passes")).toBe(0);
    await expect(as("service", "select public.sim_finish_data_load($1)", [JSON.stringify({ original_people: 2 })])).rejects.toThrow(/Unexpected table/);
    await as("service", "select public.sim_finish_data_load($1)", [JSON.stringify({ sim_original_passes: 2, sim_original_checkins: 1 })]);
    expect([await count("sim_checkins"), await count("sim_passes"), await count("sim_tickets"), await count("sim_ticket_events")]).toEqual([1, 2, 1, 1]);
    expect(await value("select count(*) from public.checkins")).toBe(before);
    expect(await value("select campaign_name from public.campaigns")).toBe("Ambassadors ");
    expect(await as("reviewer", "select public.sim_dataset_status() ready")).toEqual([{ ready: true }]);
  });
});

describe("one dataset never changes the other", () => {
  const resetBoth = async () => {
    await as("reviewer", "select public.reset_demo()");
    await as("reviewer", "select public.sim_reset_demo()");
  };
  /** one edit of every kind in one dataset */
  async function change(p: "" | "sim_") {
    await as("reviewer", `update public.${p}checkins set result = 'denied' where event_id = 'CHK1'`);
    await as("reviewer", `insert into public.${p}checkins (event_id, person_id, result, _source) values ('APP', 'P2', 'admitted', 'app')`);
    await as("reviewer", `insert into public.${p}tasks (title, owner_id) values ('task ${p}', 'T03')`);
    await as("reviewer", `insert into public.${p}change_log (table_name, row_ref, field) values ('checkins', 'CHK1', 'result')`);
    await as("reviewer", `update public.${p}settings set value = '99' where key = 'min_sample'`);
    const [{ id }] = await as<{ id: string }>("reviewer", `select public.${p}raise_ticket('extra ${p}', '', 'events', 'publicity', 'low', null, null, '2025-03-20') id`);
    await as("reviewer", `select public.${p}comment_ticket($1, 'note', '2025-03-21')`, [id]);
    await as("reviewer", `select public.${p}move_ticket($1, 'accepted', null, '2025-03-21')`, [id]);
    await as("reviewer", `select public.${p}edit_ticket($1, 'renamed', '', 'high', null, '2025-03-22')`, [id]);
    await as("reviewer", `insert into public.${p}tasks (title, ticket_id) values ('for ticket', $1)`, [id]);
  }
  const state = async (p: "" | "sim_") => ({
    admitted: await count(`${p}checkins`, "result = 'admitted'"),
    checkins: await count(`${p}checkins`),
    tasks: await count(`${p}tasks`),
    log: await count(`${p}change_log`),
    setting: await value(`select value from public.${p}settings where key = 'min_sample'`),
    tickets: await count(`${p}tickets`),
    events: await count(`${p}ticket_events`),
  });

  for (const [edited, other] of [["", "sim_"], ["sim_", ""]] as const) {
    it(`edits, tasks, tickets and change log of the ${edited ? "simulated" : "original"} data stay there, and so does its reset`, async () => {
      await resetBoth();
      const clean = { mine: await state(edited), theirs: await state(other) };
      await change(edited);
      const changed = await state(edited);
      expect(changed).toMatchObject({ checkins: clean.mine.checkins + 1, tasks: 2, log: 1, setting: 99, tickets: 2, events: clean.mine.events + 4 });
      expect(await state(other)).toEqual(clean.theirs);

      // a reset of the other dataset keeps these edits
      await as("reviewer", `select public.${other}reset_demo()`);
      expect(await state(edited)).toEqual(changed);

      // its own reset restores it and leaves the other one's edits alone
      await change(other);
      const otherChanged = await state(other);
      await as("reviewer", `select public.${edited}reset_demo()`);
      expect(await state(edited)).toEqual(clean.mine);
      expect(await state(other)).toEqual(otherChanged);
    });
  }

  it("rows added after a reset get new numbers in both", async () => {
    await resetBoth();
    for (const p of ["", "sim_"] as const) {
      await as("reviewer", `insert into public.${p}checkins (event_id) values ('N1')`);
      await as("reviewer", `insert into public.${p}checkins (event_id) values ('N2')`);
      expect(await value(`select count(distinct _row_id) = count(*) from public.${p}checkins`)).toBe(true);
    }
  });

  it("no sim_ column uses a numbering sequence of the original tables", async () => {
    const shared = await db.query<{ table_name: string; column_default: string }>(
      "select table_name, column_default from information_schema.columns where table_schema = 'public' and table_name like 'sim\\_%' and column_default like 'nextval%' and column_default not like '%sim\\_%'",
    );
    expect(shared.rows).toEqual([]);
  });

  it("chats keep their dataset; old chats count as original", async () => {
    await as("reviewer", "insert into public.chat_sessions (id, title, dataset) values ('10000000-0000-0000-0000-000000000002', 'sim chat', 'simulated')");
    const titles = async (ds: string) => (await as<{ title: string }>("reviewer", "select title from public.chat_sessions where dataset = $1", [ds])).map((r) => r.title);
    expect(await titles("original")).toEqual(["old chat"]);
    expect(await titles("simulated")).toEqual(["sim chat"]);
    await expect(as("reviewer", "insert into public.chat_sessions (id, title, dataset) values ('10000000-0000-0000-0000-000000000003', 'x', 'other')")).rejects.toThrow(/chat_sessions_dataset_check/);
    await resetBoth();
    expect((await titles("original")).concat(await titles("simulated"))).toHaveLength(2);
  });
});

describe("role rules apply to the simulated tables too", () => {
  const changes = async (who: Who, query: string) => (await as(who, `${query} returning 1`)).length;

  it("publicity edits campaigns and bet thresholds, events edits check-ins, nobody else", async () => {
    for (const p of ["", "sim_"]) {
      expect(await changes("meera", `update public.${p}campaigns set campaign_name = campaign_name`)).toBe(1);
      expect(await changes("dev", `update public.${p}campaigns set campaign_name = campaign_name`)).toBe(0);
      expect(await changes("dev", `update public.${p}checkins set result = result`)).toBeGreaterThan(0);
      expect(await changes("meera", `update public.${p}checkins set result = result`)).toBe(0);
      expect(await changes("meera", `update public.${p}people set person_name = person_name`)).toBe(0);
    }
    expect(await changes("meera", "update public.sim_bet_thresholds set scale_at = scale_at")).toBe(1);
    expect(await changes("dev", "update public.sim_bet_thresholds set scale_at = scale_at")).toBe(0);
  });

  it("a task belongs to its owner's team", async () => {
    await as("dev", "insert into public.sim_tasks (title, owner_id) values ('mine', 'T06')");
    await expect(as("dev", "insert into public.sim_tasks (title, owner_id) values ('theirs', 'T03')")).rejects.toThrow(/row-level security/);
  });

  it("ticket rules hold, and the ticket tables cannot be written directly", async () => {
    await expect(as("dev", "select public.sim_raise_ticket('t', '', 'sponsorship', 'publicity', 'low', null, null, '2025-04-19')")).rejects.toThrow(/Only the sponsorship team/);
    await expect(as("reviewer", "insert into public.sim_tickets (title, from_team, to_team, raised_on) values ('t', 'events', 'publicity', '2025-04-19')")).rejects.toThrow(/permission denied/);
  });

  it("the new tables are view only, and reset and load stay protected", async () => {
    expect(await as("dev", "select pass_id from public.sim_passes")).toHaveLength(2);
    for (const t of BET_TABLE_NAMES.filter((t) => t !== "bet_thresholds")) await expect(as("reviewer", `delete from public.sim_${t}`), t).rejects.toThrow(/permission denied/);
    for (const t of ["venues", "program_events"]) {
      await expect(as("reviewer", `delete from public.${t}`)).rejects.toThrow(/permission denied/);
      await as("dev", `select * from public.${t}`);
    }
    await expect(as("dev", "select public.sim_reset_demo()")).rejects.toThrow(/Only the Reviewer/);
    await expect(as("reviewer", "select public.sim_prepare_data_load()")).rejects.toThrow(/permission denied/);
    await expect(as("reviewer", "select * from public.sim_original_passes")).rejects.toThrow(/permission denied/);
    await expect(as("reviewer", "select public._sim_seed_app_defaults()")).rejects.toThrow(/permission denied/);
  });

  it("visitors who are not signed in get nothing", async () => {
    for (const t of [...SOURCE.map((t) => `sim_${t}`), "sim_passes", "sim_tickets", "sim_bet_thresholds", "venues"]) await expect(as("anon", `select * from public.${t}`), t).rejects.toThrow(/permission denied/);
    for (const q of ["select public.sim_get_app_data()", "select public.sim_get_rows('people', 1, 10)", "select public.sim_dataset_status()", "select public.sim_reset_demo()"]) await expect(as("anon", q), q).rejects.toThrow(/permission denied/);
  });

  it("an account without a profile sees nothing", async () => {
    await db.query("select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false), set_config('request.jwt.claim.role', 'authenticated', false)");
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select * from public.sim_people")).rows).toEqual([]);
      expect((await db.query<{ sim_dataset_status: boolean }>("select public.sim_dataset_status()")).rows[0].sim_dataset_status).toBe(false);
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("loading in pages", () => {
  type Page = { cols: string[]; rows: unknown[][] };
  const head = async (fn: string) => (await as<{ d: { versions: Record<string, string>; ranges: Record<string, number[]>; tables: Record<string, unknown[]>; bets?: Record<string, unknown[]> } }>("dev", `select public.${fn}() d`))[0].d;

  it("sends every column of every new table, and the new columns of people and registrations", async () => {
    const app = await head("sim_get_app_data");
    expect(Object.keys(app.bets!).sort()).toEqual(BET_TABLE_NAMES.filter((t) => !(PAGED_BET_TABLES as readonly string[]).includes(t)).sort());
    for (const t of PAGED_BET_TABLES) {
      expect(app.ranges[t], t).toHaveLength(3);
      expect(app.versions[t], t).toBeTruthy();
      const [{ p }] = await as<{ p: Page }>("dev", "select public.sim_get_rows($1, 1, 100) p", [t]);
      expect(p.cols, t).toEqual(["_row_id", "_source", "_deleted", ...Object.keys(BET_TABLES[t].columns)]);
    }
    const [{ p: passes }] = await as<{ p: Page }>("dev", "select public.sim_get_rows('passes', 1, 100) p");
    expect(passes.rows).toHaveLength(2);
    for (const [t, column] of [["people", "college_id"], ["registrations", "test_arm"]]) {
      const [{ p }] = await as<{ p: Page }>("dev", "select public.sim_get_rows($1, 1, 100) p", [t]);
      expect(p.cols).toContain(column);
    }
    await expect(as("dev", "select public.sim_get_rows('profiles', 1, 10)")).rejects.toThrow(/Unknown table/);
  });

  it("each table has the columns the spec lists, in the same order in both copies", async () => {
    const columns = async (t: string) => (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [t])).rows.map((r) => r.column_name);
    for (const t of BET_TABLE_NAMES) {
      expect(await columns(`sim_${t}`), t).toEqual(["_row_id", "_source", "_deleted", ...Object.keys(BET_TABLES[t].columns)]);
      expect(await columns(`sim_original_${t}`), t).toEqual(await columns(`sim_${t}`));
    }
    for (const t of SOURCE) expect(await columns(`sim_original_${t}`), t).toEqual(await columns(`sim_${t}`));
  });

  it("a change in one dataset gives a new version only there", async () => {
    const [a, b] = [await head("get_app_data"), await head("sim_get_app_data")];
    await as("dev", "update public.sim_checkins set result = result");
    const [a2, b2] = [await head("get_app_data"), await head("sim_get_app_data")];
    expect(b2.versions.checkins).not.toBe(b.versions.checkins);
    expect(a2.versions.checkins).toBe(a.versions.checkins);
    await as("reviewer", "select public.reset_demo()");
    expect((await head("sim_get_app_data")).versions).toEqual(b2.versions);
  });
});
