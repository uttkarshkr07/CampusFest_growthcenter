// A tiny simulated run, small enough to work every KPI out by hand. It follows
// strategy/tracking_spec.md. Test data only: it says nothing about the bets.
// Cast: P01-P03 contingent COL1, P04 contingent COL2 (registers late), P05-P09 one squad,
// P10-P14 individuals (P13 and P14 are the two test arms), P20-P21 hackathon only.
import { BET_TABLE_NAMES } from "@/lib/data/bet-spec";
import type { BetData, Dataset } from "@/lib/engine";

type Row = Record<string, unknown>;
export const at = (day: string, clock = "12:00:00") => `2025-${day}T${clock}+05:30`;
const on = (day: string) => `2025-${day}`;
const id = (i: number) => `P${String(i).padStart(2, "0")}`;

const SQUAD = [5, 6, 7, 8, 9].map(id);

const registrations: Row[] = [
  ...[1, 2, 3].map((i) => ({ p: id(i), when: at("03-01"), route: "contingent", contingent_id: "CON1" })),
  { p: "P04", when: at("03-22"), route: "contingent", contingent_id: "CON2" },
  ...SQUAD.map((p) => ({ p, when: at("03-01"), route: "squad", squad_id: "SQ1" })),
  { p: "P10", when: at("03-01"), route: "individual" },
  { p: "P11", when: at("03-01"), route: "individual" },
  { p: "P12", when: at("03-10"), route: "individual" },
  { p: "P13", when: at("03-01"), route: "individual", test_name: "two_step", test_arm: "treatment" },
  { p: "P14", when: at("03-01"), route: "individual", test_name: "two_step", test_arm: "control" },
].map(({ p, when, ...rest }) => ({ registration_id: `R-${p}`, person_id: p, campaign_id: "C01", registered_at: when, ...rest }));

/** person, booked, locked */
const PASSES: [string, string, string | null, string?][] = [
  ["P01", "03-05", "03-20"],
  ["P02", "03-05", "03-20"],
  ["P03", "03-05", null],
  ...SQUAD.map((p): [string, string, string] => [p, "03-08", "03-28"]),
  ["P10", "03-05", "03-30"],
  ["P12", "04-04", null],
  ["P13", "03-05", "04-01"],
  ["P14", "03-05", "03-05", "single"],
];

const passes: Row[] = PASSES.map(([p, booked, locked, plan = "two_step"]) => ({
  pass_id: `PS-${p}`, registration_id: `R-${p}`, person_id: p, price_plan: plan, price_inr: 500,
  discount_type: p === "P02" ? "contingent_25" : "none", discount_inr: p === "P02" ? 125 : 0,
  booked_at: at(booked), locked_in_at: locked ? at(locked) : null,
  // P10 claims for an exam clash and the QR is voided when it is approved
  qr_voided_at: p === "P10" ? at("04-05") : null,
}));

const payment = (p: string, kind: string, amount: number, day: string): Row => ({ payment_id: `PAY-${kind}-${p}`, pass_id: `PS-${p}`, kind, amount_inr: amount, paid_at: at(day) });
const payments: Row[] = [
  ...PASSES.flatMap(([p, booked, locked, plan]) => (plan === "single" ? [payment(p, "full", 500, booked)] : [payment(p, "booking", 99, booked), ...(locked ? [payment(p, "lock", 401, locked)] : [])])),
  ...SQUAD.map((p) => payment(p, "squad_cashback", 100, "04-15")),
  payment("P10", "refund_exam", 401, "04-05"),
];

const booking = (history: string, bk: string, person: string, event: string, day: string, status = "booked"): Row => ({ history_id: history, booking_id: bk, event_id: event, person_id: person, effective_at: at(day, "12:00:00"), status });
const offer = (n: number, over: Row = {}): Row => ({ offer_id: `O${n}`, kind: "show_seat", event_id: "E001", offered_at: at("04-06", "10:00:00"), expires_at: at("04-06", "10:10:00"), claimed_at: null, expired_at: null, ...over });
const result = (n: number, college: string, position: number, points: number): Row => ({ result_id: `RES${n}`, event_id: "E003", college_id: college, team_name: `Team ${n}`, position, points, recorded_at: at("04-13", "18:00:00") });
const threshold = (row: number, kpi: string, check: string | null, scale: number | null, stop: number | null, min: number, direction = "higher"): Row => ({
  _row_id: row, threshold_id: `TH-${kpi}`, kpi_id: kpi, check_on: check && on(check), direction, scale_at: scale, stop_at: stop, min_sample: min,
  action_scale: `${kpi} scale action`, action_change: `${kpi} change action`, action_stop: `${kpi} stop action`,
});

const tables: Partial<Record<keyof BetData, Row[]>> = {
  colleges: [
    { college_id: "COL1", college_name: "Alpha College", visited_on: on("01-20"), signed_on: on("02-01"), owner_id: "T01" },
    { college_id: "COL2", college_name: "Beta College", visited_on: on("01-25"), signed_on: on("03-20"), owner_id: "T02" },
    { college_id: "COL3", college_name: "Gamma College", visited_on: on("02-05"), signed_on: null },
    { college_id: "COL4", college_name: "Delta College", visited_on: null, signed_on: null },
  ],
  contingents: [
    { contingent_id: "CON1", college_id: "COL1", registered_at: at("02-02") },
    { contingent_id: "CON2", college_id: "COL2", registered_at: at("03-21") },
  ],
  contingent_tier_events: [{ tier_event_id: "TR1", contingent_id: "CON1", milestone: 50, reached_at: at("03-25"), discounted_slots: 10 }],
  squads: [{ squad_id: "SQ1", created_at: at("03-01"), leader_person_id: "P05" }],
  passes,
  payments,
  insurance_claims: [{ claim_id: "CL1", pass_id: "PS-P10", filed_at: at("04-01"), decision: "approved", decided_at: at("04-05"), refund_inr: 401 }],
  venues: [
    { venue_id: "VEN06", venue_name: "Hall", venue_type: "auditorium", capacity: 900, seated: true },
    { venue_id: "VEN18", venue_name: "Empty Court", venue_type: "court", capacity: null, seated: false },
  ],
  program_events: [
    { event_id: "E001", event_name: "Standup A", kind: "standup_show", starts_at: at("04-12", "16:00:00"), ends_at: at("04-12", "17:00:00"), venue_id: "VEN06", booking_required: true, seats_offered: 4 },
    { event_id: "E002", event_name: "Standup B", kind: "standup_show", starts_at: at("04-13", "16:00:00"), ends_at: at("04-13", "17:00:00"), venue_id: "VEN06", booking_required: true, seats_offered: 2 },
    { event_id: "E003", event_name: "Dance Final", kind: "competition_final", starts_at: at("04-13", "10:00:00"), ends_at: at("04-13", "12:00:00"), venue_id: "VEN06", booking_required: false, points: 100 },
  ],
  seat_booking_history: [
    booking("BH1", "BK1", "P01", "E001", "04-03"),
    booking("BH2", "BK2", "P02", "E001", "04-03"),
    booking("BH3", "BK2", "P02", "E001", "04-05", "cancelled"),
    booking("BH4", "BK3", "P03", "E001", "04-08"),
    booking("BH5", "BK4", "P05", "E001", "04-03"),
    booking("BH6", "BK5", "P06", "E002", "04-13"),
  ],
  seat_scans: [
    { scan_id: "SS1", event_id: "E001", person_id: "P01", occurred_at: at("04-12", "15:50:00"), result: "admitted" },
    { scan_id: "SS2", event_id: "E001", person_id: "P05", occurred_at: at("04-12", "15:51:00"), result: "admitted" },
    { scan_id: "SS3", event_id: "E001", person_id: "P02", occurred_at: at("04-12", "15:52:00"), result: "denied", deny_reason: "full" },
  ],
  waitlist_entries: [
    { entry_id: "W1", kind: "show_seat", event_id: "E001", person_id: "P11", joined_at: at("04-03") },
    { entry_id: "W2", kind: "show_seat", event_id: "E001", person_id: "P13", joined_at: at("04-03"), left_at: at("04-07") },
  ],
  exchange_offers: [
    offer(1, { claimed_at: at("04-06", "10:04:00") }),
    offer(2, { claimed_at: at("04-06", "10:12:00") }),
    offer(3, { expired_at: at("04-06", "10:10:00") }),
    offer(4),
    offer(5, { claimed_at: at("04-06", "10:10:00") }),
  ],
  competition_results: [result(1, "COL1", 1, 100), result(2, "COL2", 2, 60), result(3, "COL3", 3, 23.33), result(4, "COL1", 3, 23.33), result(5, "COL2", 3, 23.33)],
  hackathon_teams: [
    { team_id: "H1", team_name: "One", registered_at: at("03-25"), status: "registered" },
    { team_id: "H2", team_name: "Two", registered_at: at("03-26"), status: "registered" },
  ],
  hackathon_members: [
    { team_id: "H1", person_id: "P01" },
    { team_id: "H1", person_id: "P20" },
    { team_id: "H2", person_id: "P21" },
  ],
  bets: [
    { bet_id: "B1", bet_name: "College contingents", owner_team: "publicity", budget_inr: 1000, planned_increment_base: 10, planned_increment_stretch: 20 },
    { bet_id: "B5", bet_name: "Hackathon", owner_team: "sponsorship", budget_inr: 100, planned_increment_base: 5, planned_increment_stretch: 6, simulation_note: "SIMULATED SCENARIO: RISA Labs has not agreed to this." },
  ],
  bet_thresholds: [
    threshold(1, "K02", "03-01", 2, 1, 3),
    threshold(2, "K03", "03-15", 5, 3, 2),
    threshold(3, "K06", "03-15", 25, 15, 5),
    threshold(4, "K07", "04-02", 70, 50, 1),
    threshold(5, "K09", "03-15", 55, 40, 10),
    threshold(6, "K10", "03-25", 45, 30, 5),
    threshold(7, "K11", "04-02", 85, 70, 5),
    threshold(8, "K13", "04-01", 2, 3, 5, "lower"),
    threshold(9, "K14", "04-14", 90, 80, 5),
    threshold(10, "K15", "04-03", 60, 30, 3),
    threshold(11, "K16", "04-12", 95, 80, 1),
    threshold(12, "K19", "03-31", 25, 10, 0),
    threshold(13, "K22", null, 10, 15, 5, "lower"),
    threshold(14, "K05", "04-14", 85, 75, 2),
  ],
  bet_milestones: [{ milestone_id: "M1", bet_id: "B5", milestone: "Written approval from the sponsor", due_on: on("03-22"), done_on: on("03-20") }],
  bet_spend: [
    { spend_id: "S1", bet_id: "B1", spent_on: on("02-01"), amount_inr: 600, item: "Visits" },
    { spend_id: "S2", bet_id: "B1", spent_on: on("04-10"), amount_inr: 600, item: "Trophies" },
  ],
};

const scan = (n: number, person: string, day: string, clock: string, result_ = "admitted"): Row => ({ event_id: `SCAN${n}`, person_id: person, occurred_at: at(day, clock), result: result_, verification: "verified", source: "scanner" });

export function p5Fixture(): Dataset {
  const people = [...Array.from({ length: 14 }, (_, i) => id(i + 1)), "P20", "P21"].map((p) => ({ person_id: p, person_name: `Person ${p}`, person_type: "external", first_seen_at: at("02-01") }));
  const bets = Object.fromEntries(BET_TABLE_NAMES.map((t) => [t, (tables[t] ?? []).map((r, i) => ({ _row_id: i + 1, ...r }))])) as unknown as BetData;
  return structuredClone({
    event: [{ event_name: "Fixture", history_start: "2025-01-15", history_end: "2025-04-20", event_starts_at: at("04-12", "10:00:00"), event_ends_at: at("04-13", "23:00:00") }],
    targets: [],
    campaigns: [{ campaign_id: "C01", campaign_name: "College Partnerships", channel: "partnerships", created_at: at("01-15") }],
    daily_marketing: [{ activity_id: "A1", campaign_id: "C01", activity_date: "2025-02-01", marketing_spend_inr: 5000 }],
    people,
    interactions: [],
    registrations,
    registration_history: registrations.map((r) => ({ history_id: `H-${r.registration_id}`, registration_id: r.registration_id, person_id: r.person_id, effective_at: r.registered_at, status: "confirmed" })),
    checkins: [
      ...["P01", "P02", "P06", "P07", "P08", "P09", "P13"].map((p, i) => scan(i + 1, p, "04-12", "18:00:00")),
      scan(20, "P05", "04-12", "17:00:00", "denied"),
      scan(21, "P05", "04-12", "17:05:00"),
      scan(22, "P14", "04-12", "17:10:00", "denied"),
    ],
    sponsor_activations: [],
    campaign_plan: [],
    team: [{ owner_id: "T01", owner_name: "Meera", team: "publicity" }, { owner_id: "T02", owner_name: "Riya", team: "sponsorship" }],
    tasks: [],
    settings: [],
    change_log: [],
    tickets: [],
    ticket_events: [],
    bets,
  }) as unknown as Dataset;
}
