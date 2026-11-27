// Problem records in the bet and program sheets (simulated dataset). They all load: planned anomalies
// such as an overbooked show must be able to reach the app. The load command lists them with their
// Excel row. The values and rules come from strategy/tracking_spec.md. Nothing is changed or guessed.
// Relative imports only: the load command runs this file outside the app.
import type { Issue } from "../engine/quality";
import { toMs } from "../engine/time";
import { tidy } from "../engine/vocab";
import { BET_TABLES, BET_TABLE_NAMES, type BetTableName } from "./bet-spec";
import { empty, rowNo, type Row } from "./convert";

/** the most external passes that may be valid at the same time */
export const PASS_CAP = 13000;
const SQUAD_SIZE = 5;
const OFFER_WINDOW_MS = 10 * 60 * 1000;
const TIER_SLOTS: Record<number, number> = { 50: 10, 100: 15, 150: 20 };

/** rows as written in the workbooks (with __row), including the attendee sheets the rules look into */
export type BetSource = Record<BetTableName, Row[]>;
export interface AttendeeSource {
  event: Row[];
  people: Row[];
  registrations: Row[];
  checkins: Row[];
  /** owner ids from the Team sheet */
  ownerIds: Set<string>;
}

/** column -> allowed words (compared without capitals or outer spaces); an empty value is allowed */
export const WORDS: Partial<Record<BetTableName | "registrations", Record<string, string[]>>> = {
  registrations: { route: ["individual", "squad", "contingent"], test_name: ["two_step", "squad_offer"], test_arm: ["treatment", "control"] },
  colleges: { college_type: ["du", "ggsipu", "ncr_other", "health", "outstation"], outreach_wave: ["a", "b"] },
  passes: { pass_type: ["normal", "accommodation"], price_plan: ["two_step", "single", "gate"], discount_type: ["none", "contingent_25"], cancel_reason: ["normal", "exam_clash", "not_locked"] },
  payments: { kind: ["booking", "lock", "full", "gate", "refund_resale", "refund_exam", "squad_cashback", "wallet_credit"] },
  perk_grants: { perk: ["wristband", "wallet_100", "wallet_50", "window_1", "window_2"] },
  insurance_claims: { proof_type: ["datesheet", "college_letter"], decision: ["pending", "approved", "rejected"] },
  seat_booking_history: { status: ["booked", "cancelled", "released"] },
  seat_scans: { result: ["admitted", "denied"], deny_reason: ["full", "no_booking", "invalid"] },
  waitlist_entries: { kind: ["show_seat", "pass"] },
  exchange_offers: { kind: ["show_seat", "pass"] },
  hackathon_teams: { status: ["registered", "withdrawn"] },
  bets: { bet_id: ["b1", "b2", "b3", "b4", "b5"], owner_team: ["publicity", "sponsorship", "events"] },
  bet_thresholds: { direction: ["higher", "lower"] },
};

type Target = BetTableName | "people" | "registrations" | "team" | "bookings";
/** [column, what it points to] */
export const LINKS: Partial<Record<BetTableName | "people" | "registrations", [string, Target][]>> = {
  people: [["college_id", "colleges"]],
  registrations: [["squad_id", "squads"], ["contingent_id", "contingents"]],
  colleges: [["owner_id", "team"]],
  contingents: [["college_id", "colleges"], ["head_person_id", "people"]],
  contingent_tier_events: [["contingent_id", "contingents"]],
  squads: [["leader_person_id", "people"]],
  passes: [["registration_id", "registrations"], ["person_id", "people"]],
  payments: [["pass_id", "passes"]],
  perk_grants: [["pass_id", "passes"]],
  insurance_claims: [["pass_id", "passes"]],
  program_events: [["venue_id", "venues"]],
  seat_booking_history: [["event_id", "program_events"], ["person_id", "people"], ["pass_id", "passes"]],
  seat_scans: [["event_id", "program_events"], ["person_id", "people"]],
  waitlist_entries: [["event_id", "program_events"], ["person_id", "people"]],
  exchange_offers: [["event_id", "program_events"], ["entry_id", "waitlist_entries"], ["source_booking_id", "bookings"], ["new_booking_id", "bookings"], ["source_pass_id", "passes"], ["new_pass_id", "passes"]],
  competition_results: [["event_id", "program_events"], ["college_id", "colleges"]],
  hackathon_teams: [["college_id", "colleges"]],
  hackathon_members: [["team_id", "hackathon_teams"], ["person_id", "people"]],
  bet_thresholds: [["bet_id", "bets"]],
  bet_milestones: [["bet_id", "bets"]],
  bet_spend: [["bet_id", "bets"]],
};

const ID_OF: Record<Exclude<Target, "team" | "bookings">, string> = {
  people: "person_id",
  registrations: "registration_id",
  ...(Object.fromEntries(BET_TABLE_NAMES.map((t) => [t, BET_TABLES[t].required[0]])) as Record<BetTableName, string>),
};

const text = (v: unknown) => (empty(v) ? "" : String(v));
const time = (v: unknown) => toMs(typeof v === "string" ? v : null);

/** one row per id; the last row wins */
function latest(rows: Row[], id: string): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const r of rows) if (text(r[id])) out.set(text(r[id]), r);
  return out;
}

export function betIssues(bets: BetSource, attendee: AttendeeSource): Issue[] {
  const issues = new Map<string, Issue>();
  const add = (code: string, table: string, title: string, rule: string, row: Row | null, id: unknown, detail: string) => {
    const key = `${table}:${code}`;
    let issue = issues.get(key);
    if (!issue) issues.set(key, (issue = { code, effect: "check", table, title, rule, records: [] }));
    const excel = row ? rowNo(row) : undefined;
    issue.records.push({ id: String(id || "(no id)"), detail, ...(excel ? { row: excel } : {}) });
  };
  const AS_WRITTEN = "Loads as written. Check that it is what you meant.";

  const tables: Record<string, Row[]> = { ...bets, people: attendee.people, registrations: attendee.registrations };
  const idColumn = (t: string) => ID_OF[t as keyof typeof ID_OF];

  // words
  for (const [table, columns] of Object.entries(WORDS)) {
    for (const r of tables[table] ?? []) {
      for (const [column, allowed] of Object.entries(columns!)) {
        if (!empty(r[column]) && !allowed.includes(String(tidy(r[column])))) add(`unknown_${column}`, table, `Unknown ${column}`, "The word is never guessed, so the record may not be counted.", r, r[idColumn(table)], `${column} is ${JSON.stringify(r[column])}; allowed: ${allowed.join(", ")}`);
      }
    }
  }

  // links
  const known: Record<string, Set<string>> = { team: attendee.ownerIds, bookings: new Set(bets.seat_booking_history.map((r) => text(r.booking_id))) };
  const idsOf = (target: Target) => (known[target] ??= new Set(tables[target].map((r) => text(r[idColumn(target)]))));
  for (const [table, links] of Object.entries(LINKS)) {
    for (const r of tables[table] ?? []) {
      for (const [column, target] of links!) {
        if (!empty(r[column]) && !idsOf(target).has(text(r[column]))) add(`unknown_${column}`, table, `${column} points to nothing`, "Never matched by guessing.", r, r[idColumn(table)], `${column} ${text(r[column])} is not in the ${target.replace(/_/g, " ")} records`);
      }
    }
  }

  // one id with two different rows (an exact copy is an import retried, and is fine)
  for (const table of BET_TABLE_NAMES) {
    if (table === "hackathon_members") continue;
    const column = BET_TABLES[table].required[0];
    const seen = new Map<string, string>();
    for (const r of bets[table]) {
      const id = text(r[column]);
      const body = JSON.stringify(Object.keys(BET_TABLES[table].columns).map((c) => r[c] ?? null));
      if (seen.has(id) && seen.get(id) !== body) add("conflicting_id", table, "Same ID, different contents", "The last row wins.", r, id, `${column} ${id} appears again with other values`);
      seen.set(id, body);
    }
  }

  const people = latest(attendee.people, "person_id");
  const passes = latest(bets.passes, "pass_id");
  const registrations = latest(attendee.registrations, "registration_id");
  const events = latest(bets.program_events, "event_id");
  const venues = latest(bets.venues, "venue_id");

  // squads: at most five members
  const members = new Map<string, Set<string>>();
  for (const r of registrations.values()) {
    const squad = text(r.squad_id);
    if (squad) members.set(squad, (members.get(squad) ?? new Set()).add(text(r.person_id)));
  }
  for (const [squad, who] of members) if (who.size > SQUAD_SIZE) add("squad_too_big", "squads", "More than 5 people in a squad", AS_WRITTEN, null, squad, `${who.size} people are registered in squad ${squad}`);

  // cashback only when all five have a qualifying scan
  const event = attendee.event[0] ?? {};
  const [start, end] = [time(event.event_starts_at), time(event.event_ends_at)];
  const attended = new Set(
    attendee.checkins
      .filter((c) => tidy(c.result) === "admitted" && tidy(c.verification) === "verified" && time(c.occurred_at) >= start && time(c.occurred_at) <= end)
      .map((c) => text(c.person_id)),
  );
  for (const p of bets.payments) {
    if (tidy(p.kind) !== "squad_cashback") continue;
    const registration = registrations.get(text(passes.get(text(p.pass_id))?.registration_id));
    const squad = text(registration?.squad_id);
    const arrived = [...(members.get(squad) ?? [])].filter((id) => attended.has(id)).length;
    if (!squad || arrived < SQUAD_SIZE) add("cashback_without_full_squad", "payments", "Squad cashback without 5 qualifying scans", AS_WRITTEN, p, p.payment_id, squad ? `squad ${squad} has ${arrived} of 5 members scanned in` : "the pass is not in a squad");
  }

  // passes: dates in order, and the cap on valid external passes
  const changes: { at: number; by: 1 | -1 }[] = [];
  const firstPayment = new Map<string, number>();
  for (const p of bets.payments) {
    const at = time(p.paid_at);
    if (Number.isFinite(at)) firstPayment.set(text(p.pass_id), Math.min(at, firstPayment.get(text(p.pass_id)) ?? at));
  }
  for (const [id, p] of passes) {
    const [booked, locked, cancelled, voided] = [time(p.booked_at), time(p.locked_in_at), time(p.cancelled_at), time(p.qr_voided_at)];
    if (locked < booked) add("lock_before_booking", "passes", "Locked in before it was booked", AS_WRITTEN, p, id, "locked_in_at is before booked_at");
    if (cancelled < booked) add("cancel_before_booking", "passes", "Cancelled before it was booked", AS_WRITTEN, p, id, "cancelled_at is before booked_at");
    if (tidy(people.get(text(p.person_id))?.person_type) !== "external") continue;
    const from = [booked, locked, firstPayment.get(id) ?? NaN].find((v) => Number.isFinite(v));
    if (from === undefined) continue;
    const until = Math.min(...[cancelled, voided].filter((v) => Number.isFinite(v)));
    if (until <= from) continue;
    changes.push({ at: from, by: 1 });
    if (Number.isFinite(until)) changes.push({ at: until, by: -1 });
  }
  let valid = 0;
  let peak = 0;
  // at the same moment, a pass given up frees its place before the next one takes it
  for (const c of changes.sort((a, b) => a.at - b.at || a.by - b.by)) peak = Math.max(peak, (valid += c.by));
  if (peak > PASS_CAP) add("pass_cap", "passes", "More valid external passes than the cap", AS_WRITTEN, null, "all passes", `${peak} external passes were valid at once; the cap is ${PASS_CAP}`);

  // program and seats
  for (const [id, e] of events) {
    if (time(e.ends_at) <= time(e.starts_at)) add("ends_before_start", "program_events", "Ends before it starts", AS_WRITTEN, e, id, "ends_at is not after starts_at");
    const capacity = Number(venues.get(text(e.venue_id))?.capacity ?? NaN);
    if (!empty(venues.get(text(e.venue_id))?.capacity) && Number(e.seats_offered) > capacity) add("seats_over_capacity", "program_events", "More seats offered than the venue holds", AS_WRITTEN, e, id, `${e.seats_offered} seats in a venue for ${capacity}`);
  }
  const history = [...latest(bets.seat_booking_history, "history_id").values()].sort((a, b) => time(a.effective_at) - time(b.effective_at));
  const booked = new Map<string, Set<string>>();
  const over = new Map<string, { peak: number; row: Row }>();
  for (const h of history) {
    const eventId = text(h.event_id);
    const seats = booked.get(eventId) ?? new Set<string>();
    booked.set(eventId, seats);
    if (tidy(h.status) === "booked") seats.add(text(h.booking_id));
    else seats.delete(text(h.booking_id));
    const offered = events.get(eventId)?.seats_offered;
    if (!empty(offered) && seats.size > Number(offered) && seats.size > (over.get(eventId)?.peak ?? 0)) over.set(eventId, { peak: seats.size, row: h });
  }
  for (const [eventId, o] of over) add("overbooked", "seat_booking_history", "More bookings than seats offered", AS_WRITTEN, o.row, eventId, `${eventId} reached ${o.peak} bookings for ${events.get(eventId)!.seats_offered} seats`);

  // exchange offers
  for (const o of bets.exchange_offers) {
    const [offered, expires, claimed, expired] = [time(o.offered_at), time(o.expires_at), time(o.claimed_at), time(o.expired_at)];
    if (Number.isFinite(offered) && Number.isFinite(expires) && expires - offered !== OFFER_WINDOW_MS) add("offer_window", "exchange_offers", "Offer window is not 10 minutes", AS_WRITTEN, o, o.offer_id, "expires_at should be 10 minutes after offered_at");
    if (Number.isFinite(claimed) && Number.isFinite(expired)) add("claimed_and_expired", "exchange_offers", "Both claimed and expired", AS_WRITTEN, o, o.offer_id, "claimed_at and expired_at are both filled");
    if (claimed > expires) add("claimed_late", "exchange_offers", "Claimed after the window closed", AS_WRITTEN, o, o.offer_id, "claimed_at is after expires_at");
  }

  // contingent tiers and competition results
  for (const t of bets.contingent_tier_events) {
    if (!empty(t.milestone) && TIER_SLOTS[Number(t.milestone)] !== Number(t.discounted_slots)) add("tier_slots", "contingent_tier_events", "Tier does not match the plan", AS_WRITTEN, t, t.tier_event_id, `milestone ${t.milestone} with ${t.discounted_slots} slots; the plan is 50/10, 100/15, 150/20`);
  }
  for (const r of bets.competition_results) {
    if (!empty(r.position) && ![1, 2, 3, 4, 5].includes(Number(r.position))) add("position", "competition_results", "Position is not 1 to 5", AS_WRITTEN, r, r.result_id, `position is ${r.position}`);
    const worth = events.get(text(r.event_id))?.points;
    if (!empty(worth) && Number(r.points) > Number(worth)) add("points_over_event", "competition_results", "More points than the event is worth", AS_WRITTEN, r, r.result_id, `${r.points} points in an event worth ${worth}`);
  }

  return [...issues.values()];
}
