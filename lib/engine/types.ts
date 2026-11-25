// Source row shapes mirror the xlsx columns (snake_case). Timestamps are ISO strings
// (from the seed: "+05:30"; from Postgres: any offset). `_row_id`, `_source`, `_deleted`
// exist only on rows loaded from Supabase or created in the app.

export interface RowMeta {
  _row_id?: number;
  _source?: "original" | "app";
  _deleted?: boolean;
}

export interface EventRow extends RowMeta {
  event_name: string;
  history_start: string;
  history_end: string;
  event_starts_at: string;
  event_ends_at: string;
  timezone: string;
  currency: string;
  fictional: boolean;
}

export interface TargetRow extends RowMeta {
  effective_at: string;
  identified_external_people_goal: number;
  registration_goal: number;
  unique_external_visitors_goal: number;
  marketing_budget_inr: number;
  target_version: string;
}

export interface CampaignRow extends RowMeta {
  campaign_id: string;
  campaign_name: string;
  channel: string | null;
  target_audience: string | null;
  objective: string | null;
  owner_name: string | null;
  owner_id: string | null;
  created_at: string;
  planned_start_at: string | null;
  planned_end_at: string | null;
}

export interface DailyRow extends RowMeta {
  activity_id: string;
  campaign_id: string;
  campaign_name: string | null;
  owner_name: string | null;
  owner_id: string | null;
  activity_date: string; // YYYY-MM-DD (IST day)
  impressions: number | null;
  clicks: number | null;
  reported_reach: number | null;
  landing_page_sessions: number | null;
  registration_starts: number | null;
  marketing_spend_inr: number | null;
  platform: string | null;
}

export type PersonType = "external" | "internal" | "staff" | "test";

export interface PersonRow extends RowMeta {
  person_id: string;
  person_name: string;
  person_type: PersonType | string;
  first_seen_at: string;
  first_touch_source: string | null;
  first_campaign_name: string | null;
  first_campaign_id: string | null;
  owner_name: string | null;
  owner_id: string | null;
}

export interface InteractionRow extends RowMeta {
  interaction_id: string;
  person_id: string;
  person_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  owner_name: string | null;
  owner_id: string | null;
  occurred_at: string;
  event_type: string;
  detail: string | null;
}

export interface RegistrationRow extends RowMeta {
  registration_id: string;
  person_id: string;
  person_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  owner_name: string | null;
  owner_id: string | null;
  registered_at: string;
}

export type RegStatus = "interested" | "confirmed" | "cancelled" | "waitlisted";

export interface HistoryRow extends RowMeta {
  history_id: string;
  registration_id: string;
  person_id: string;
  person_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  owner_name: string | null;
  owner_id: string | null;
  effective_at: string;
  status: RegStatus | string;
}

export interface CheckinRow extends RowMeta {
  event_id: string;
  person_id: string;
  person_name: string | null;
  registration_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  owner_name: string | null;
  owner_id: string | null;
  occurred_at: string;
  result: "admitted" | "denied" | "pending" | string;
  verification: "verified" | "unverified" | string;
  source: "scanner" | "manual" | string;
}

export interface SponsorActivationRow extends RowMeta {
  activation_id: string;
  brand_name: string;
  opportunity_name: string | null;
  attendee_campaign_name: string | null;
  attendee_campaign_id: string | null;
  activation_note: string | null;
  linked_at: string;
}

// ---- App tables ----
export type CampaignAppStatus = "planned" | "active" | "paused" | "stopped";

export interface CampaignPlanRow {
  campaign_id: string;
  app_status: CampaignAppStatus;
  budget_inr: number | null;
  notes: string | null;
  updated_at?: string;
}

export interface TeamRow {
  owner_id: string;
  owner_name: string;
  team: "publicity" | "events" | "sponsorship" | string;
}

export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type TaskOrigin = "manual" | "rule" | "copilot";

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  campaign_id: string | null;
  owner_id: string | null;
  due_at: string | null;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  origin: TaskOrigin;
  origin_ref: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface ChangeLogRow {
  id: number | string;
  table_name: string;
  row_ref: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
}

export interface Dataset {
  event: EventRow[];
  targets: TargetRow[];
  campaigns: CampaignRow[];
  daily_marketing: DailyRow[];
  people: PersonRow[];
  interactions: InteractionRow[];
  registrations: RegistrationRow[];
  registration_history: HistoryRow[];
  checkins: CheckinRow[];
  sponsor_activations: SponsorActivationRow[];
  campaign_plan: CampaignPlanRow[];
  team: TeamRow[];
  tasks: TaskRow[];
  settings: SettingRow[];
  change_log: ChangeLogRow[];
}

export const SOURCE_TABLES = [
  "event",
  "targets",
  "campaigns",
  "daily_marketing",
  "people",
  "interactions",
  "registrations",
  "registration_history",
  "checkins",
  "sponsor_activations",
] as const;
export type SourceTable = (typeof SOURCE_TABLES)[number];

/** Every engine answer carries its evidence trail. */
export interface Result<T> {
  value: T;
  basis: string[];
  caveats: string[];
}
