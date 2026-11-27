// The sim_ database functions are copies of the original ones. This fails when a copy and its
// original stop being the same apart from the table names, so a fix to one cannot miss the other.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(`supabase/${file}`, "utf8").replace(/\r\n/g, "\n");

/** from "create or replace function public.<name>(" to the end of its body */
function definition(file: string, name: string): string {
  const text = read(file);
  const start = text.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} is not in ${file}`);
  const open = /\bas\s+(\$[a-z]*\$)/.exec(text.slice(start))!;
  const bodyStart = start + open.index + open[0].length;
  return text.slice(start, text.indexOf(open[1], bodyStart) + open[1].length);
}

/** the copy with its prefix taken off */
const unprefixed = (sql: string) =>
  sql
    .replace(/'sim_' \|\| t\b/g, "t")
    .replace(/'sim_original_' \|\| t\b/g, "'original_' || t")
    .replace(/public\.sim_' \|\| t \|\|/g, "public.' || t ||")
    .replace(/_sim_/g, "_")
    .replace(/\bsim_/g, "")
    .replace(/\^sim_/g, "^");

const tidy = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
/** the lists of tables differ on purpose */
const withoutTableLists = (sql: string) => sql.replace(/array\[[^\]]*\]/g, "array[...]").replace(/truncate table [^;]*? restart identity/g, "truncate table ... restart identity");

const SAME: [string, string, string][] = [
  ["patch_session3a.sql", "can_edit_task", "sim_can_edit_task"],
  ["patch_session3d_tickets.sql", "_ticket_owner_in_team", "_sim_ticket_owner_in_team"],
  ["patch_session3d_tickets.sql", "raise_ticket", "sim_raise_ticket"],
  ["patch_session3d_tickets.sql", "move_ticket", "sim_move_ticket"],
  ["patch_session3d_tickets.sql", "comment_ticket", "sim_comment_ticket"],
  ["patch_session3d_tickets.sql", "edit_ticket", "sim_edit_ticket"],
  ["patch_session3e_scale.sql", "_apply_tickets", "_sim_apply_tickets"],
  ["patch_session3e_scale.sql", "_seed_app_defaults", "_sim_seed_app_defaults"],
  ["patch_session3e_scale.sql", "finish_data_load", "sim_finish_data_load"],
];
const SAME_BUT_TABLE_LISTS: [string, string, string][] = [
  ["patch_session3e_scale.sql", "reset_demo", "sim_reset_demo"],
  ["patch_session3e_scale.sql", "prepare_data_load", "sim_prepare_data_load"],
];

describe("sim_ database functions match the originals", () => {
  const copy = (name: string) => tidy(unprefixed(definition("patch_session4_datasets.sql", name)));

  it.each(SAME)("%s %s", (file, original, sim) => {
    expect(copy(sim)).toBe(tidy(definition(file, original)));
  });

  it.each(SAME_BUT_TABLE_LISTS)("%s %s, apart from the list of tables", (file, original, sim) => {
    expect(withoutTableLists(copy(sim))).toBe(withoutTableLists(tidy(definition(file, original))));
  });

  it("paged loading sends the same columns, plus the new ones", () => {
    const branches = (sql: string) => [...sql.matchAll(/json_build_array\(('_row_id'[^)]*)\)/g)].map((m) => m[1].split(","));
    const original = branches(definition("patch_session3e_scale.sql", "get_rows"));
    const sim = branches(definition("patch_session4_datasets.sql", "sim_get_rows"));
    expect(sim).toHaveLength(original.length);
    sim.forEach((cols, i) => expect(cols.slice(0, original[i].length)).toEqual(original[i]));
  });

  it("every table the original load and reset handle is handled for the simulated data", () => {
    const names = (sql: string) => new Set([...sql.matchAll(/'(\w+)'|public\.(\w+)/g)].map((m) => m[1] ?? m[2]));
    for (const [original, sim] of [["reset_demo", "sim_reset_demo"], ["prepare_data_load", "sim_prepare_data_load"], ["get_app_data", "sim_get_app_data"]]) {
      const have = names(unprefixed(definition("patch_session4_datasets.sql", sim)));
      for (const n of names(definition("patch_session3e_scale.sql", original))) expect(have.has(n), `${sim} is missing ${n}`).toBe(true);
    }
  });
});
