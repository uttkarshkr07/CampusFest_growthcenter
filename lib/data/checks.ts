// Checks on the converted workbooks before anything is loaded. "errors" are things the database or
// the app cannot take: the load stops. "warnings" are loaded and reported.
// Relative imports only: the load command runs this file outside the app.
import { dataQuality, type Issue } from "../engine/quality";
import { DEFAULT_SETTINGS } from "../engine/settings";
import type { SponsorData } from "../engine/sponsor";
import type { Dataset } from "../engine/types";
import type { DatasetId } from "../datasets";
import { betIssues, type BetSource } from "./bet-checks";
import { BET_TABLES, BET_TABLE_NAMES, SIMULATED_EXTRA_COLUMNS, type Kind } from "./bet-spec";
import { asNumber, convertTable, empty, isDate, rowNo, type Problem, type Row, type TableSpec } from "./convert";

export { isDate, isDateTime } from "./convert";
export type { Problem } from "./convert";

export interface Converted {
  headers: Record<string, string[]>;
  problems: Problem[];
  attendee: Record<string, Row[]>;
  sponsor: Record<string, Row[]>;
  ops: Record<string, Row[]>;
  /** Bet Dataset.xlsx: the simulated dataset only */
  bets?: Record<string, Row[]>;
}

const cols = (spec: string): Record<string, Kind> =>
  Object.fromEntries(
    spec.split(" ").map((c) => {
      const [name, kind = "text"] = c.split(":");
      return [name, kind as Kind];
    }),
  );
const OWNER = "owner_name owner_id";

export const ATTENDEE: Record<string, TableSpec> = {
  event: { sheet: "Event", required: ["history_start", "history_end", "event_starts_at", "event_ends_at"], columns: cols("event_name history_start:date history_end:date event_starts_at:datetime event_ends_at:datetime timezone currency fictional:boolean") },
  targets: { sheet: "Targets", required: ["effective_at"], columns: cols("effective_at:datetime identified_external_people_goal:number registration_goal:number unique_external_visitors_goal:number marketing_budget_inr:number target_version") },
  campaigns: { sheet: "Campaigns", required: ["campaign_id"], columns: cols(`campaign_id campaign_name channel target_audience objective ${OWNER} created_at:datetime planned_start_at:datetime planned_end_at:datetime`) },
  daily_marketing: { sheet: "Daily Marketing", required: ["activity_id", "activity_date"], columns: cols(`activity_id campaign_id campaign_name ${OWNER} activity_date:date impressions:number clicks:number reported_reach:number landing_page_sessions:number registration_starts:number marketing_spend_inr:number platform`) },
  people: { sheet: "People", required: ["person_id"], columns: cols(`person_id person_name person_type first_seen_at:datetime first_touch_source first_campaign_name first_campaign_id ${OWNER}`) },
  interactions: { sheet: "Interest and Engagement", required: ["interaction_id"], columns: cols(`interaction_id person_id person_name campaign_id campaign_name ${OWNER} occurred_at:datetime event_type detail`) },
  registrations: { sheet: "Registrations", required: ["registration_id"], columns: cols(`registration_id person_id person_name campaign_id campaign_name ${OWNER} registered_at:datetime`) },
  registration_history: { sheet: "Registration History", required: ["history_id"], columns: cols(`history_id registration_id person_id person_name campaign_id campaign_name ${OWNER} effective_at:datetime status`) },
  checkins: { sheet: "Check-ins", required: ["event_id"], columns: cols(`event_id person_id person_name registration_id campaign_id campaign_name ${OWNER} occurred_at:datetime result verification source`) },
  sponsor_activations: { sheet: "Sponsor activations", required: ["activation_id"], columns: cols("activation_id brand_name opportunity_name attendee_campaign_name attendee_campaign_id activation_note linked_at:datetime brand_id opportunity_id") },
};

/** the columns the sponsor calculations read */
const SPONSOR_NEEDS: Record<string, string> = {
  targets: "effective_at qualified_brands_goal confirmed_partnerships_goal target_version",
  brands: "brand_id brand_name industry owner_id owner_name created_at",
  contacts: "contact_id brand_id contact_name job_title created_at",
  campaigns: "sponsor_campaign_id campaign_name channel owner_name created_at",
  interactions: "interaction_id attempt_id brand_id contact_id sponsor_campaign_id event_type outcome occurred_at",
  qualification: "history_id brand_id qualification_status sponsor_campaign_id effective_at",
  opportunities: "opportunity_id opportunity_name brand_id sponsor_campaign_id support_type created_at",
  opportunity_history: "history_id opportunity_id brand_id stage proposed_value_inr confirmed_value_inr owner_name effective_at",
  activations: "activation_id brand_id opportunity_id attendee_campaign_id linked_at",
};

const OPS_NEEDS: Record<string, string> = {
  team: "owner_id owner_name team",
  settings: "key value",
  campaign_plan: "campaign_id app_status budget_inr",
  tickets: "ticket_key title details from_team to_team requester_id assignee_id priority raised_on needed_by accepted_on declined_on decline_reason started_on done_on simulation_note",
};

const TEAMS = ["publicity", "sponsorship", "events"];
const PRIORITIES = ["low", "medium", "high"];
const PLAN_STATUS = ["planned", "active", "paused", "stopped"];

export interface TicketOut {
  ticket_key: string;
  id: string;
  title: string;
  details: string;
  from_team: string;
  to_team: string;
  requester_id: string | null;
  assignee_id: string | null;
  priority: string;
  raised_on: string;
  needed_by: string | null;
  accepted_on: string | null;
  declined_on: string | null;
  decline_reason: string | null;
  started_on: string | null;
  done_on: string | null;
  simulation_note: string | null;
}

export interface CheckResult {
  errors: Problem[];
  warnings: Problem[];
  issues: Issue[];
  /** rows ready for the original_* tables, keyed by table name */
  originals: Record<string, Row[]>;
  sponsor: Record<string, Row[]>;
  counts: Record<string, number>;
}

export function checkDataset(input: Converted, options: { accountOwnerIds: string[]; ticketId: (key: string) => string; dataset?: DatasetId }): CheckResult {
  const errors: Problem[] = [...input.problems];
  const warnings: Problem[] = [];
  const originals: Record<string, Row[]> = {};
  const simulated = options.dataset === "simulated";

  const needColumns = (key: string, sheet: string, wanted: string[]) => {
    const have = input.headers[key];
    if (!have) return false;
    const missing = wanted.filter((c) => !have.includes(c));
    if (missing.length) errors.push({ sheet, row: 1, text: `Missing column(s): ${missing.join(", ")}` });
    return !missing.length;
  };
  /** checks the columns, then puts every value in its type; null when the sheet cannot be read */
  const readSheet = (key: string, spec: TableSpec, source: Row[] | undefined, ignored: string[] = []): Row[] | null => {
    if (!source || !needColumns(key, spec.sheet, Object.keys(spec.columns))) return null;
    const extra = (input.headers[key] ?? []).filter((c) => !(c in spec.columns) && !ignored.includes(c));
    if (extra.length) warnings.push({ sheet: spec.sheet, row: 1, text: `Extra column(s) are not loaded: ${extra.join(", ")}` });
    return convertTable(spec, source, errors, warnings);
  };

  // ---- attendee sheets, plus the activations sheet from the sponsor workbook ----
  for (const [table, spec] of Object.entries(ATTENDEE)) {
    const fromSponsor = table === "sponsor_activations";
    const added = (simulated && SIMULATED_EXTRA_COLUMNS[table]) || [];
    const full = added.length ? { ...spec, columns: { ...spec.columns, ...Object.fromEntries(added.map((c) => [c, "text" as Kind])) } } : spec;
    const rows = readSheet(fromSponsor ? "sponsor.activations" : `attendee.${table}`, full, fromSponsor ? input.sponsor.activations : input.attendee[table]);
    if (rows) originals[`original_${table}`] = rows;
  }

  // ---- bet and program sheets ----
  if (simulated) {
    for (const table of BET_TABLE_NAMES) {
      const rows = readSheet(`bets.${table}`, BET_TABLES[table], input.bets?.[table], table === "program_events" ? ["day"] : []);
      if (rows) originals[`original_${table}`] = rows;
      else if (!input.headers[`bets.${table}`] && !input.problems.some((p) => p.sheet.endsWith(BET_TABLES[table].sheet) || p.sheet === "Bet Dataset.xlsx")) errors.push({ sheet: BET_TABLES[table].sheet, text: "The sheet is missing" });
    }
  }

  const event = originals.original_event;
  if (event) {
    if (event.length !== 1) errors.push({ sheet: "Event", text: `There must be exactly one event row; there are ${event.length}` });
    else {
      const e = event[0] as Record<string, string>;
      const start = Date.parse(e.event_starts_at);
      const end = Date.parse(e.event_ends_at);
      if (start >= end) errors.push({ sheet: "Event", row: 2, text: "event_ends_at must be after event_starts_at" });
      if (e.history_start > String(e.event_starts_at).slice(0, 10)) errors.push({ sheet: "Event", row: 2, text: "history_start is after the event starts" });
      if (e.history_end < String(e.event_ends_at).slice(0, 10)) errors.push({ sheet: "Event", row: 2, text: "history_end is before the event ends" });
    }
  }
  for (const table of ["original_targets", "original_campaigns", "original_people"]) if (originals[table] && !originals[table].length) errors.push({ sheet: table.replace("original_", ""), text: "The sheet has no rows" });

  // ---- sponsor sheets: stored as they are; only the columns are checked ----
  for (const [key, wanted] of Object.entries(SPONSOR_NEEDS)) if (input.sponsor[key]) needColumns(`sponsor.${key}`, `Sponsor: ${key}`, wanted.split(" "));

  // ---- the operations workbook ----
  for (const [key, wanted] of Object.entries(OPS_NEEDS)) if (input.ops[key]) needColumns(`ops.${key}`, key, wanted.split(" "));
  const unique = (rows: Row[], column: string, sheet: string) => {
    const seen = new Set<string>();
    for (const r of rows) {
      const v = String(r[column] ?? "").trim();
      if (!v) errors.push({ sheet, row: rowNo(r), text: `${column} is empty` });
      else if (seen.has(v)) errors.push({ sheet, row: rowNo(r), text: `${column} ${v} is used twice` });
      seen.add(v);
    }
    return seen;
  };

  const team = input.ops.team ?? [];
  const ownerIds = unique(team, "owner_id", "Team");
  const teamOf = new Map<string, string>();
  originals.original_team = team.map((r) => {
    const group = String(r.team ?? "").trim().toLowerCase();
    if (!TEAMS.includes(group)) errors.push({ sheet: "Team", row: rowNo(r), text: `team must be one of ${TEAMS.join(", ")}` });
    if (empty(r.owner_name)) errors.push({ sheet: "Team", row: rowNo(r), text: "owner_name is empty" });
    teamOf.set(String(r.owner_id), group);
    return { owner_id: String(r.owner_id ?? ""), owner_name: String(r.owner_name ?? ""), team: group };
  });
  const withoutAccount = [...ownerIds].filter((id) => id && !options.accountOwnerIds.includes(id));
  if (withoutAccount.length) warnings.push({ sheet: "Team", text: `No sign-in account for ${withoutAccount.join(", ")} (see lib/auth/accounts.json)` });
  const orphanAccounts = options.accountOwnerIds.filter((id) => !ownerIds.has(id));
  if (orphanAccounts.length) warnings.push({ sheet: "Team", text: `Sign-in accounts exist for ${orphanAccounts.join(", ")}, who are not in the Team sheet` });

  const settings = (input.ops.settings ?? []).filter((r) => !empty(r.value));
  unique(settings, "key", "Settings");
  originals.original_settings = settings.map((r) => {
    const key = String(r.key ?? "").trim();
    if (key === "story_today") {
      const day = String(r.value).slice(0, 10);
      if (!isDate(day)) errors.push({ sheet: "Settings", row: rowNo(r), text: "story_today must be a date as YYYY-MM-DD" });
      return { key, value: day };
    }
    const value = asNumber(r.value);
    if (value === null) errors.push({ sheet: "Settings", row: rowNo(r), text: `${key} must be a number` });
    if (!(key in DEFAULT_SETTINGS)) warnings.push({ sheet: "Settings", row: rowNo(r), text: `${key} is not a setting the app uses` });
    return { key, value };
  });
  for (const key of Object.keys(DEFAULT_SETTINGS)) if (!settings.some((r) => r.key === key)) warnings.push({ sheet: "Settings", text: `${key} is not set; the app uses ${DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS]}` });

  const campaignIds = new Set((originals.original_campaigns ?? []).map((c) => String(c.campaign_id)));
  const plan = input.ops.campaign_plan ?? [];
  unique(plan, "campaign_id", "Campaign plan");
  originals.original_campaign_plan = plan.map((r) => {
    const status = empty(r.app_status) ? "active" : String(r.app_status).trim().toLowerCase();
    if (!PLAN_STATUS.includes(status)) errors.push({ sheet: "Campaign plan", row: rowNo(r), text: `app_status must be one of ${PLAN_STATUS.join(", ")}` });
    const budget = empty(r.budget_inr) ? null : asNumber(r.budget_inr);
    if (!empty(r.budget_inr) && budget === null) errors.push({ sheet: "Campaign plan", row: rowNo(r), text: "budget_inr must be a number or empty" });
    if (!campaignIds.has(String(r.campaign_id))) warnings.push({ sheet: "Campaign plan", row: rowNo(r), text: `${String(r.campaign_id)} is not a campaign` });
    return { campaign_id: String(r.campaign_id ?? ""), app_status: status, budget_inr: budget, notes: empty(r.notes) ? null : String(r.notes) };
  });

  const tickets = input.ops.tickets ?? [];
  unique(tickets, "ticket_key", "Tickets");
  const historyEnd = String(event?.[0]?.history_end ?? "");
  const historyStart = String(event?.[0]?.history_start ?? "");
  originals.original_tickets = tickets.map((r) => {
    const fail = (text: string) => errors.push({ sheet: "Tickets", row: rowNo(r), text });
    const warn = (text: string) => warnings.push({ sheet: "Tickets", row: rowNo(r), text });
    const text = (v: unknown) => (empty(v) ? null : String(v).trim());
    const when = (column: string) => {
      const v = r[column];
      if (empty(v)) return null;
      if (!isDate(v)) fail(`${column} is not a readable date: ${JSON.stringify(v)}`);
      return isDate(v) ? v : null;
    };
    const word = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const t: TicketOut = {
      ticket_key: String(r.ticket_key ?? ""),
      id: options.ticketId(String(r.ticket_key ?? "")),
      title: String(r.title ?? "").trim(),
      details: String(r.details ?? ""),
      from_team: word(r.from_team),
      to_team: word(r.to_team),
      requester_id: text(r.requester_id),
      assignee_id: text(r.assignee_id),
      priority: word(r.priority) || "medium",
      raised_on: when("raised_on") ?? "",
      needed_by: when("needed_by"),
      accepted_on: when("accepted_on"),
      declined_on: when("declined_on"),
      decline_reason: text(r.decline_reason),
      started_on: when("started_on"),
      done_on: when("done_on"),
      simulation_note: text(r.simulation_note),
    };
    if (!t.title || t.title.length > 140) fail("title must be 1 to 140 characters");
    if (t.details.length > 4000) fail("details must be 4,000 characters or fewer");
    if (!TEAMS.includes(t.from_team) || !TEAMS.includes(t.to_team)) fail(`from_team and to_team must be one of ${TEAMS.join(", ")}`);
    else if (t.from_team === t.to_team) fail("from_team and to_team must be different");
    if (!PRIORITIES.includes(t.priority)) fail(`priority must be one of ${PRIORITIES.join(", ")}`);
    if (!t.raised_on) fail("raised_on is required");
    for (const column of ["needed_by", "accepted_on", "declined_on"] as const) if (t[column] && t[column]! < t.raised_on) fail(`${column} is before raised_on`);
    if (t.accepted_on && t.declined_on) fail("a ticket cannot be both accepted and declined");
    if (t.started_on && (!t.accepted_on || t.started_on < t.accepted_on)) fail("started_on needs an accepted_on on or before it");
    if (t.done_on && (!t.started_on || t.done_on < t.started_on)) fail("done_on needs a started_on on or before it");
    if (t.decline_reason && !t.declined_on) warn("decline_reason is ignored without declined_on");
    for (const [column, id, expected] of [["requester_id", t.requester_id, t.from_team], ["assignee_id", t.assignee_id, t.to_team]] as const) {
      if (!id) continue;
      if (!ownerIds.has(id)) warn(`${column} ${id} is not in the Team sheet`);
      else if (teamOf.get(id) !== expected) warn(`${column} ${id} is listed in the ${teamOf.get(id)} team, not ${expected}`);
    }
    if (historyEnd && [t.raised_on, t.accepted_on, t.declined_on, t.started_on, t.done_on].some((d) => d && (d > historyEnd || d < historyStart)))
      warn(`has a date outside ${historyStart} to ${historyEnd}, so it can never be selected in the app`);
    return t as unknown as Row;
  });

  // ---- problem records, found by the same checks the app's Data quality screen uses ----
  const asRows = (key: string) => (key === "sponsor_activations" ? (input.sponsor.activations ?? []) : (input.attendee[key] ?? []));
  const dataset = { ...Object.fromEntries(Object.keys(ATTENDEE).map((t) => [t, asRows(t)])), campaign_plan: [], team: originals.original_team, tasks: [], settings: [], change_log: [], tickets: [], ticket_events: [] } as unknown as Dataset;
  const sponsorComplete = Object.keys(SPONSOR_NEEDS).every((k) => input.sponsor[k]);
  const issues = dataQuality(dataset, sponsorComplete ? (input.sponsor as unknown as SponsorData) : null);
  if (simulated && input.bets && BET_TABLE_NAMES.every((t) => input.bets![t])) {
    const attendee = { event: input.attendee.event ?? [], people: input.attendee.people ?? [], registrations: input.attendee.registrations ?? [], checkins: input.attendee.checkins ?? [], ownerIds };
    issues.push(...betIssues(input.bets as BetSource, attendee));
  }

  const sponsor = Object.fromEntries(
    Object.keys(SPONSOR_NEEDS).map((k) => [k, (input.sponsor[k] ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([c]) => c !== "__row")))]),
  );
  const counts = Object.fromEntries(Object.entries(originals).map(([t, rows]) => [t, rows.length]));
  return { errors, warnings, issues, originals, sponsor, counts };
}
