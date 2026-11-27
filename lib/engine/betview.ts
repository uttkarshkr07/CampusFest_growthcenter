// The as-of rule for every bet and program table (strategy/tracking_spec.md, "Global rules").
// A row exists only from its own event time. A column that records something later (a lock-in,
// a decision, a claim) is blank until that time. The program, the bets and their thresholds are
// the plan, so they are always visible. Repeated IDs: the last row wins.
import type { BetData, BetRow } from "./types";
import { endOfIstDay, resolveAsOf, toMs } from "./time";

export const text = (v: unknown): string => (v == null ? "" : String(v));
export const word = (v: unknown): string => text(v).trim().toLowerCase();
export const numberOf = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export const isSet = (v: unknown) => text(v).trim() !== "";

/** a timestamp that had happened by `ms`; empty or unreadable means it had not */
export const timeBy = (v: unknown, ms: number) => {
  const t = toMs(text(v) || null);
  return Number.isFinite(t) && t <= ms;
};
/** a date column counts once its IST day is over, like daily marketing rows */
export const dayBy = (v: unknown, ms: number) => {
  const t = endOfIstDay(text(v).slice(0, 10));
  return Number.isFinite(t) && t <= ms;
};

function lastWins(rows: BetRow[] | undefined, key: (r: BetRow) => string): BetRow[] {
  const byId = new Map<string, BetRow>();
  (rows ?? []).forEach((r, i) => {
    if (!r._deleted) byId.set(key(r) || `#${i}`, r);
  });
  return [...byId.values()];
}
const by = (column: string) => (r: BetRow) => text(r[column]);

/** clears `columns` when the time that explains them has not come yet */
function blank(row: BetRow, happened: boolean, columns: Record<string, unknown>): BetRow {
  return happened ? row : { ...row, ...columns };
}

const cache = new WeakMap<BetData, Map<number, BetData>>();

export function betsAsOf(bets: BetData, asOf: string): BetData {
  const { ms } = resolveAsOf(asOf);
  let byDate = cache.get(bets);
  if (!byDate) cache.set(bets, (byDate = new Map()));
  const hit = byDate.get(ms);
  if (hit) return hit;

  const had = (column: string) => (r: BetRow) => timeBy(r[column], ms);

  const payments = lastWins(bets.payments, by("payment_id")).filter(had("paid_at"));
  const paidPass = new Set(payments.map((p) => text(p.pass_id)));

  // a pass is known from its first booking, lock-in or payment (gate passes may have no booking)
  const passes = lastWins(bets.passes, by("pass_id"))
    .filter((p) => timeBy(p.booked_at, ms) || timeBy(p.locked_in_at, ms) || timeBy(p.id_verified_at, ms) || paidPass.has(text(p.pass_id)))
    .map((p) => {
      let out = blank(p, timeBy(p.booked_at, ms), { booked_at: null, booking_amount_inr: null });
      out = blank(out, timeBy(p.locked_in_at, ms), { locked_in_at: null, lock_amount_inr: null, hostel_name: null });
      out = blank(out, timeBy(p.id_verified_at, ms), { id_verified_at: null });
      out = blank(out, timeBy(p.cancelled_at, ms), { cancelled_at: null, cancel_reason: null });
      return blank(out, timeBy(p.qr_voided_at, ms), { qr_voided_at: null });
    });

  const teams = lastWins(bets.hackathon_teams, by("team_id")).filter(had("registered_at"));
  const teamIds = new Set(teams.map((t) => text(t.team_id)));

  const out: BetData = {
    colleges: lastWins(bets.colleges, by("college_id")).map((c) => ({
      ...c,
      visited_on: dayBy(c.visited_on, ms) ? c.visited_on : null,
      signed_on: dayBy(c.signed_on, ms) ? c.signed_on : null,
      od_letter_on: dayBy(c.od_letter_on, ms) ? c.od_letter_on : null,
    })),
    contingents: lastWins(bets.contingents, by("contingent_id")).filter(had("registered_at")),
    contingent_tier_events: lastWins(bets.contingent_tier_events, by("tier_event_id")).filter(had("reached_at")),
    squads: lastWins(bets.squads, by("squad_id")).filter(had("created_at")),
    passes,
    payments,
    perk_grants: lastWins(bets.perk_grants, by("grant_id"))
      .filter(had("granted_at"))
      .map((g) => blank(g, timeBy(g.collected_at, ms), { collected_at: null })),
    insurance_claims: lastWins(bets.insurance_claims, by("claim_id"))
      .filter(had("filed_at"))
      .map((c) => blank(c, timeBy(c.decided_at, ms), { decision: "pending", decided_at: null, refund_inr: null })),
    venues: lastWins(bets.venues, by("venue_id")),
    program_events: lastWins(bets.program_events, by("event_id")),
    seat_booking_history: lastWins(bets.seat_booking_history, by("history_id")).filter(had("effective_at")),
    seat_scans: lastWins(bets.seat_scans, by("scan_id")).filter(had("occurred_at")),
    waitlist_entries: lastWins(bets.waitlist_entries, by("entry_id"))
      .filter(had("joined_at"))
      .map((w) => blank(w, timeBy(w.left_at, ms), { left_at: null })),
    exchange_offers: lastWins(bets.exchange_offers, by("offer_id"))
      .filter(had("offered_at"))
      .map((o) => {
        const out = blank(o, timeBy(o.claimed_at, ms), { claimed_at: null, new_booking_id: null, new_pass_id: null });
        return blank(out, timeBy(o.expired_at, ms), { expired_at: null });
      }),
    competition_results: lastWins(bets.competition_results, by("result_id")).filter(had("recorded_at")),
    hackathon_teams: teams,
    hackathon_members: lastWins(bets.hackathon_members, (r) => `${text(r.team_id)}|${text(r.person_id)}`).filter((m) => teamIds.has(text(m.team_id))),
    bets: lastWins(bets.bets, by("bet_id")),
    bet_thresholds: lastWins(bets.bet_thresholds, by("threshold_id")),
    bet_milestones: lastWins(bets.bet_milestones, by("milestone_id")).map((m) => ({ ...m, done_on: dayBy(m.done_on, ms) ? m.done_on : null })),
    bet_spend: lastWins(bets.bet_spend, by("spend_id")).filter((s) => dayBy(s.spent_on, ms)),
  };
  byDate.set(ms, out);
  return out;
}
