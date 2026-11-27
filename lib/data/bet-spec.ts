// The bet and program tables (strategy/tracking_spec.md), which only the simulated dataset has.
// The same columns are in supabase/patch_session4_datasets.sql and scripts/dataset_to_json.py;
// tests/db_isolation.test.ts and tests/bet_checks.test.ts keep the three in step.
// Relative imports only: the load command runs this file outside the app.

export type Kind = "text" | "number" | "boolean" | "date" | "datetime";

export interface BetTableSpec {
  /** sheet name in Bet Dataset.xlsx */
  sheet: string;
  columns: Record<string, Kind>;
  /** the load stops when one of these is empty */
  required: string[];
  /** may be missing from rows without being a problem */
  extra?: string[];
}

const cols = (spec: string): Record<string, Kind> =>
  Object.fromEntries(
    spec.split(" ").map((c) => {
      const [name, kind = "text"] = c.split(":");
      return [name, kind as Kind];
    }),
  );
const table = (sheet: string, required: string, columns: string): BetTableSpec => ({ sheet, required: required.split(" "), columns: cols(columns) });

export const BET_TABLES = {
  colleges: table("Colleges", "college_id", "college_id college_name college_type cluster visited_on:date signed_on:date od_letter_on:date outreach_wave owner_id"),
  contingents: table("Contingents", "contingent_id", "contingent_id college_id head_person_id registered_at:datetime"),
  contingent_tier_events: table("Contingent tiers", "tier_event_id", "tier_event_id contingent_id milestone:number reached_at:datetime discounted_slots:number"),
  squads: table("Squads", "squad_id", "squad_id created_at:datetime leader_person_id"),
  passes: table(
    "Passes",
    "pass_id",
    "pass_id registration_id person_id pass_type price_plan price_inr:number discount_type discount_inr:number booked_at:datetime booking_amount_inr:number locked_in_at:datetime lock_amount_inr:number id_verified_at:datetime hostel_name cancelled_at:datetime cancel_reason qr_voided_at:datetime",
  ),
  payments: table("Payments", "payment_id", "payment_id pass_id kind amount_inr:number paid_at:datetime"),
  perk_grants: table("Perks", "grant_id", "grant_id pass_id perk granted_at:datetime collected_at:datetime cost_inr:number"),
  insurance_claims: table("Insurance claims", "claim_id", "claim_id pass_id filed_at:datetime proof_type decision decided_at:datetime refund_inr:number"),
  venues: table("Venues", "venue_id", "venue_id venue_name venue_type capacity:number seated:boolean map_x:number map_y:number notes"),
  program_events: table(
    "Program events",
    "event_id",
    "event_id event_name brand_name cup scored:boolean points:number kind starts_at:datetime ends_at:datetime venue_id booking_required:boolean seats_offered:number audience sponsor notes",
  ),
  seat_booking_history: table("Seat bookings", "history_id booking_id", "history_id booking_id event_id person_id pass_id effective_at:datetime status"),
  seat_scans: table("Seat scans", "scan_id", "scan_id event_id person_id occurred_at:datetime result deny_reason"),
  waitlist_entries: table("Waitlist", "entry_id", "entry_id kind event_id person_id joined_at:datetime left_at:datetime"),
  exchange_offers: table(
    "Exchange offers",
    "offer_id",
    "offer_id kind event_id entry_id source_booking_id source_pass_id offered_at:datetime expires_at:datetime claimed_at:datetime expired_at:datetime new_booking_id new_pass_id",
  ),
  competition_results: table("Competition results", "result_id", "result_id event_id college_id team_name position:number points:number recorded_at:datetime"),
  hackathon_teams: table("Hackathon teams", "team_id", "team_id team_name college_id registered_at:datetime status"),
  hackathon_members: table("Hackathon members", "team_id person_id", "team_id person_id"),
  bets: table("Bets", "bet_id", "bet_id rank:number bet_name owner_team budget_inr:number planned_increment_base:number planned_increment_stretch:number simulation_note"),
  bet_thresholds: table(
    "Bet thresholds",
    "threshold_id kpi_id",
    "threshold_id kpi_id bet_id check_on:date direction scale_at:number stop_at:number min_sample:number action_scale action_change action_stop",
  ),
  bet_milestones: table("Bet milestones", "milestone_id bet_id", "milestone_id bet_id milestone due_on:date done_on:date"),
  bet_spend: table("Bet spend", "spend_id bet_id", "spend_id bet_id spent_on:date amount_inr:number item"),
} satisfies Record<string, BetTableSpec>;

export type BetTableName = keyof typeof BET_TABLES;
export const BET_TABLE_NAMES = Object.keys(BET_TABLES) as BetTableName[];

/** the large ones are downloaded in pages */
export const PAGED_BET_TABLES = ["passes", "payments", "perk_grants", "seat_booking_history", "seat_scans", "waitlist_entries", "exchange_offers"] as const;
export type PagedBetTable = (typeof PAGED_BET_TABLES)[number];

/** the program: the original dataset has these two as well, read only */
export const PROGRAM_TABLES = ["venues", "program_events"] as const;

/** new columns on two existing sheets of the simulated attendee workbook */
export const SIMULATED_EXTRA_COLUMNS: Record<string, string[]> = {
  people: ["college_id"],
  registrations: ["route", "squad_id", "contingent_id", "test_name", "test_arm"],
};
