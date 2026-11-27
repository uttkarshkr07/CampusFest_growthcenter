// A very small, clean set of rows for every bet and program sheet, written as a workbook would give
// them. It is test data only: it is never loaded and says nothing about the bets.
import { BET_TABLES, BET_TABLE_NAMES, type BetTableName } from "@/lib/data/bet-spec";

type Row = Record<string, unknown>;
const at = (day: string, clock = "10:00:00") => `${day}T${clock}+05:30`;

const ROWS: Record<BetTableName, Row[]> = {
  colleges: [{ college_id: "COL1", college_name: "Fixture College", college_type: "du", cluster: "North", visited_on: "2025-02-10", signed_on: "2025-02-20", outreach_wave: "A", owner_id: "T03" }],
  contingents: [{ contingent_id: "CON1", college_id: "COL1", head_person_id: "E0001", registered_at: at("2025-02-21") }],
  contingent_tier_events: [{ tier_event_id: "TIER1", contingent_id: "CON1", milestone: 50, reached_at: at("2025-03-01"), discounted_slots: 10 }],
  squads: [{ squad_id: "SQ1", created_at: at("2025-03-02"), leader_person_id: "E0002" }],
  passes: [{ pass_id: "PASS1", registration_id: "R0001", person_id: "E0001", pass_type: "normal", price_plan: "two_step", price_inr: 500, discount_type: "none", discount_inr: 0, booked_at: at("2025-03-05"), booking_amount_inr: 99, locked_in_at: at("2025-03-20"), lock_amount_inr: 401 }],
  payments: [{ payment_id: "PAY1", pass_id: "PASS1", kind: "booking", amount_inr: 99, paid_at: at("2025-03-05") }],
  perk_grants: [{ grant_id: "PERK1", pass_id: "PASS1", perk: "wristband", granted_at: at("2025-03-05"), cost_inr: 20 }],
  insurance_claims: [{ claim_id: "CLM1", pass_id: "PASS1", filed_at: at("2025-03-25"), proof_type: "datesheet", decision: "pending" }],
  venues: [{ venue_id: "VEN1", venue_name: "Hall", venue_type: "auditorium", capacity: 200, seated: "yes", map_x: 1, map_y: 2 }],
  program_events: [{ event_id: "E001", event_name: "Show", scored: "no", kind: "show", starts_at: at("2025-04-12", "16:00:00"), ends_at: at("2025-04-12", "17:00:00"), venue_id: "VEN1", booking_required: "yes", seats_offered: 1 }],
  seat_booking_history: [{ history_id: "BH1", booking_id: "BK1", event_id: "E001", person_id: "E0001", pass_id: "PASS1", effective_at: at("2025-04-01"), status: "booked" }],
  seat_scans: [{ scan_id: "SS1", event_id: "E001", person_id: "E0001", occurred_at: at("2025-04-12", "15:50:00"), result: "admitted" }],
  waitlist_entries: [{ entry_id: "WL1", kind: "show_seat", event_id: "E001", person_id: "E0002", joined_at: at("2025-04-02") }],
  exchange_offers: [{ offer_id: "OF1", kind: "show_seat", event_id: "E001", entry_id: "WL1", source_booking_id: "BK1", offered_at: at("2025-04-03", "10:00:00"), expires_at: at("2025-04-03", "10:10:00"), expired_at: at("2025-04-03", "10:10:00") }],
  competition_results: [{ result_id: "RES1", event_id: "E001", college_id: "COL1", team_name: "Team", position: 1, points: 0, recorded_at: at("2025-04-12", "18:00:00") }],
  hackathon_teams: [{ team_id: "HT1", team_name: "Team", college_id: "COL1", registered_at: at("2025-03-26"), status: "registered" }],
  hackathon_members: [{ team_id: "HT1", person_id: "E0003" }],
  bets: [{ bet_id: "B1", rank: 1, bet_name: "Contingents", owner_team: "publicity", budget_inr: 1000, planned_increment_base: 10, planned_increment_stretch: 20, simulation_note: "SIMULATED" }],
  bet_thresholds: [{ threshold_id: "TH1", kpi_id: "K02", bet_id: "B1", check_on: "2025-03-01", direction: "higher", scale_at: 45, stop_at: 25, min_sample: 50 }],
  bet_milestones: [{ milestone_id: "M1", bet_id: "B1", milestone: "Kit sent", due_on: "2025-02-01", done_on: "2025-02-01" }],
  bet_spend: [{ spend_id: "SP1", bet_id: "B1", spent_on: "2025-02-01", amount_inr: 100, item: "Kit" }],
};

/** fresh copies, with every column present and Excel row numbers */
export function betSheets(): { bets: Record<string, Row[]>; headers: Record<string, string[]> } {
  const bets: Record<string, Row[]> = {};
  const headers: Record<string, string[]> = {};
  for (const table of BET_TABLE_NAMES) {
    const columns = Object.keys(BET_TABLES[table].columns);
    bets[table] = ROWS[table].map((r, i) => ({ ...Object.fromEntries(columns.map((c) => [c, r[c] ?? null])), __row: i + 2 }));
    headers[`bets.${table}`] = columns;
  }
  return { bets, headers };
}
