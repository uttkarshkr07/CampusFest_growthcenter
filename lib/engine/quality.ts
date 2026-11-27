// Every problem record, listed. The app shows this on the Data quality screen and the load command
// runs the same checks on the Excel files. Nothing here changes a record or guesses a value.
// Relative imports only: the load command runs this file outside the app.
import { dedupe } from "./prepare";
import type { SponsorData } from "./sponsor";
import { toMs } from "./time";
import type { Dataset } from "./types";
import { KNOWN, tidy } from "./vocab";

/** excluded = left out of calculations; read_as = read as a tidied value; check = counted as written, worth a look; info = expected by the rules */
export type Effect = "excluded" | "read_as" | "check" | "info";

export interface IssueRecord {
  id: string;
  detail: string;
  /** row number in the Excel sheet, when the data came straight from the workbook */
  row?: number;
}

export interface Issue {
  code: string;
  effect: Effect;
  table: string;
  title: string;
  /** what the app does with these records */
  rule: string;
  records: IssueRecord[];
}

type Row = Record<string, unknown>;
const EFFECT_ORDER: Effect[] = ["excluded", "check", "read_as", "info"];

const cache = new WeakMap<Dataset, Issue[]>();

export function dataQuality(data: Dataset, sponsor?: SponsorData | null): Issue[] {
  if (sponsor) return findIssues(data, sponsor);
  let found = cache.get(data);
  if (!found) cache.set(data, (found = findIssues(data, null)));
  return found;
}

function findIssues(data: Dataset, sponsor: SponsorData | null | undefined): Issue[] {
  const issues = new Map<string, Issue>();
  const add = (code: string, effect: Effect, table: string, title: string, rule: string, row: Row | null, id: unknown, detail: string) => {
    const key = `${table}:${code}`;
    let issue = issues.get(key);
    if (!issue) issues.set(key, (issue = { code, effect, table, title, rule, records: [] }));
    const excel = row?.__row;
    issue.records.push({ id: String(id ?? "(no id)"), detail, ...(typeof excel === "number" ? { row: excel } : {}) });
  };

  const live = (rows: unknown): Row[] => ((rows ?? []) as Row[]).filter((r) => !r._deleted);

  /** repeated ids, missing ids, then one copy of each row */
  const unique = (table: string, rows: Row[], idField: string): Row[] => {
    for (const r of rows) if (r[idField] == null || r[idField] === "") add("missing_id", "check", table, "No ID", "Rows without an ID are treated as copies of each other, so all but one are lost. Give each row its own ID.", r, null, `${idField} is empty`);
    const { rows: out, stat } = dedupe(rows, idField as never, table);
    const kept = new Set(out);
    const conflicting = new Set(stat.conflictingIds);
    for (const r of rows) {
      if (kept.has(r)) continue;
      if (conflicting.has(String(r[idField] ?? ""))) add("conflicting_id", "check", table, "Same ID, different contents", "The last row with the ID is used; the others are ignored.", r, r[idField], "an earlier version of a reused ID");
      else add("import_copy", "info", table, "Exact copies", "An identical row with the same ID counts once.", r, r[idField], "copy");
    }
    return out;
  };

  const times = (table: string, rows: Row[], idField: string, column: string) => {
    for (const r of rows) {
      if (Number.isFinite(toMs(r[column] as string))) continue;
      add("unreadable_time", "excluded", table, "No readable date or time", "Left out of every dated figure.", r, r[idField], `${column}: ${r[column] == null || r[column] === "" ? "empty" : JSON.stringify(r[column])}`);
    }
  };

  const words = (table: string, rows: Row[], idField: string, column: string, known: readonly string[] | null) => {
    for (const r of rows) {
      const raw = r[column];
      if (typeof raw !== "string") {
        if (known && (raw == null || raw === "")) add("unknown_value", "check", table, "Empty or unknown value", "Never guessed. The row does not count wherever this value matters.", r, r[idField], `${column} is empty`);
        continue;
      }
      const value = tidy(raw);
      if (value !== raw) add("read_as", "read_as", table, "Capital letters or extra spaces", "Read as the tidy word. Fix the source if that is wrong.", r, r[idField], `${column}: ${JSON.stringify(raw)} read as ${value}`);
      if (known && !known.includes(value)) add("unknown_value", "check", table, "Empty or unknown value", "Never guessed. The row does not count wherever this value matters.", r, r[idField], `${column}: ${JSON.stringify(raw)} is not one of ${known.join(", ")}`);
    }
  };

  const links = (table: string, rows: Row[], idField: string, column: string, valid: Set<string>, what: string, rule: string) => {
    for (const r of rows) {
      const v = r[column];
      if (v == null || v === "" || valid.has(String(v))) continue;
      add(`unknown_${column}`, "check", table, `Points to a ${what} that does not exist`, rule, r, r[idField], `${column}: ${String(v)}`);
    }
  };
  const ids = (rows: Row[], column: string) => new Set(rows.map((r) => String(r[column])));

  // ---- attendee data ----
  const people = unique("people", live(data.people), "person_id");
  const campaigns = unique("campaigns", live(data.campaigns), "campaign_id");
  const daily = unique("daily_marketing", live(data.daily_marketing), "activity_id");
  const interactions = unique("interactions", live(data.interactions), "interaction_id");
  const registrations = unique("registrations", live(data.registrations), "registration_id");
  const history = unique("registration_history", live(data.registration_history), "history_id");
  const checkins = unique("checkins", live(data.checkins), "event_id");

  times("people", people, "person_id", "first_seen_at");
  times("interactions", interactions, "interaction_id", "occurred_at");
  times("registrations", registrations, "registration_id", "registered_at");
  times("registration_history", history, "history_id", "effective_at");
  times("checkins", checkins, "event_id", "occurred_at");
  times("daily_marketing", daily, "activity_id", "activity_date");

  words("people", people, "person_id", "person_type", KNOWN.person_type);
  words("checkins", checkins, "event_id", "result", KNOWN.result);
  words("checkins", checkins, "event_id", "verification", KNOWN.verification);
  words("checkins", checkins, "event_id", "source", null);
  words("registration_history", history, "history_id", "status", KNOWN.status);
  words("interactions", interactions, "interaction_id", "event_type", null);

  const personIds = ids(people, "person_id");
  const campaignIds = ids(campaigns, "campaign_id");
  const regIds = ids(registrations, "registration_id");
  for (const [table, rows, idField] of [
    ["interactions", interactions, "interaction_id"],
    ["registrations", registrations, "registration_id"],
    ["registration_history", history, "history_id"],
    ["checkins", checkins, "event_id"],
  ] as const) {
    links(table, rows, idField, "person_id", personIds, "person", "The person cannot be identified, so the row does not count for anyone.");
    links(table, rows, idField, "campaign_id", campaignIds, "campaign", "Counted in overall figures but in no campaign's row.");
  }
  links("people", people, "person_id", "first_campaign_id", campaignIds, "campaign", "Counted in overall figures but in no campaign's row.");
  links("daily_marketing", daily, "activity_id", "campaign_id", campaignIds, "campaign", "The spend is in the total but in no campaign's row.");
  links("registration_history", history, "history_id", "registration_id", regIds, "registration", "The status applies to no registration.");
  links("checkins", checkins, "event_id", "registration_id", regIds, "registration", "The scan is still matched to its person.");

  const withHistory = ids(history, "registration_id");
  for (const r of registrations) if (!withHistory.has(String(r.registration_id))) add("no_status", "check", "registrations", "Registration with no status history", "Registered, with no status.", r, r.registration_id, "no history rows");
  const byPerson = new Map<string, Row[]>();
  for (const r of registrations) if (r.person_id) byPerson.set(String(r.person_id), [...(byPerson.get(String(r.person_id)) ?? []), r]);
  for (const [pid, list] of byPerson) if (list.length > 1) add("multiple_registrations", "check", "registrations", "One person registered more than once", "The person counts once, under the earliest registration.", list[1], pid, list.map((r) => r.registration_id).join(", "));

  const event = live(data.event)[0];
  const start = toMs(event?.event_starts_at as string);
  const end = toMs(event?.event_ends_at as string);
  const type = new Map(people.map((p) => [String(p.person_id), tidy(p.person_type)]));
  for (const c of checkins) {
    if (tidy(c.result) !== "admitted" || tidy(c.verification) !== "verified") continue;
    const at = toMs(c.occurred_at as string);
    if (Number.isFinite(at) && Number.isFinite(start) && Number.isFinite(end) && (at < start || at > end))
      add("outside_event", "excluded", "checkins", "Admission scanned outside event hours", "Does not count as attendance. If the gate really was open, change the event's start or end time.", c, c.event_id, `${String(c.occurred_at)} for ${String(c.person_id)}`);
    const t = type.get(String(c.person_id));
    if (t && t !== "external") add("not_a_visitor", "info", "checkins", "Admission of internal, staff or test people", "Never counted as attendance.", c, c.event_id, `${String(c.person_id)} is ${String(t)}`);
  }

  const netByCampaign = new Map<string, number>();
  for (const d of daily) {
    const spend = Number(d.marketing_spend_inr ?? 0);
    netByCampaign.set(String(d.campaign_id), (netByCampaign.get(String(d.campaign_id)) ?? 0) + spend);
    if (!Number.isFinite(spend)) add("bad_number", "check", "daily_marketing", "Spend is not a number", "Fix the source.", d, d.activity_id, JSON.stringify(d.marketing_spend_inr));
    else if (spend < 0) add("vendor_credit", "info", "daily_marketing", "Negative spend rows", "Treated as vendor credits that reduce spend.", d, d.activity_id, `${spend} for ${String(d.campaign_id)}`);
  }
  for (const [id, net] of netByCampaign) if (net < 0) add("negative_total", "check", "daily_marketing", "A campaign's total spend is below zero", "Shown as it is. Credits are larger than the spend.", null, id, `net ${net}`);

  // ---- sponsor data ----
  if (sponsor) {
    const brands = unique("sponsor_brands", live(sponsor.brands), "brand_id");
    const contacts = unique("sponsor_contacts", live(sponsor.contacts), "contact_id");
    const sCampaigns = unique("sponsor_campaigns", live(sponsor.campaigns), "sponsor_campaign_id");
    const touches = unique("sponsor_interactions", live(sponsor.interactions), "interaction_id");
    const quals = unique("sponsor_qualification", live(sponsor.qualification), "history_id");
    const opps = unique("sponsor_opportunities", live(sponsor.opportunities), "opportunity_id");
    const versions = unique("sponsor_opportunity_history", live(sponsor.opportunity_history), "history_id");

    times("sponsor_brands", brands, "brand_id", "created_at");
    times("sponsor_interactions", touches, "interaction_id", "occurred_at");
    times("sponsor_qualification", quals, "history_id", "effective_at");
    times("sponsor_opportunities", opps, "opportunity_id", "created_at");
    times("sponsor_opportunity_history", versions, "history_id", "effective_at");

    words("sponsor_interactions", touches, "interaction_id", "event_type", KNOWN.sponsor_event_type);
    words("sponsor_interactions", touches, "interaction_id", "outcome", null);
    words("sponsor_qualification", quals, "history_id", "qualification_status", KNOWN.qualification_status);
    words("sponsor_opportunity_history", versions, "history_id", "stage", KNOWN.stage);
    words("sponsor_opportunities", opps, "opportunity_id", "support_type", KNOWN.support_type);

    const brandIds = ids(brands, "brand_id");
    const contactIds = ids(contacts, "contact_id");
    const sCampaignIds = ids(sCampaigns, "sponsor_campaign_id");
    const oppIds = ids(opps, "opportunity_id");
    for (const [table, rows, idField] of [
      ["sponsor_contacts", contacts, "contact_id"],
      ["sponsor_interactions", touches, "interaction_id"],
      ["sponsor_qualification", quals, "history_id"],
      ["sponsor_opportunities", opps, "opportunity_id"],
      ["sponsor_opportunity_history", versions, "history_id"],
    ] as const) {
      links(table, rows, idField, "brand_id", brandIds, "brand", "The row cannot be matched to a brand.");
      links(table, rows, idField, "sponsor_campaign_id", sCampaignIds, "sponsor campaign", "Counted overall but in no campaign's row.");
    }
    links("sponsor_interactions", touches, "interaction_id", "contact_id", contactIds, "contact", "The contact cannot be named.");
    links("sponsor_opportunity_history", versions, "history_id", "opportunity_id", oppIds, "opportunity", "The version belongs to no opportunity.");
    const hasVersion = ids(versions, "opportunity_id");
    for (const o of opps) if (!hasVersion.has(String(o.opportunity_id))) add("no_stage", "check", "sponsor_opportunities", "Opportunity with no stage history", "It has no stage, so it is not listed.", o, o.opportunity_id, "no history rows");
  }

  return [...issues.values()].sort((a, b) => EFFECT_ORDER.indexOf(a.effect) - EFFECT_ORDER.indexOf(b.effect) || b.records.length - a.records.length);
}

/** the short form: what and how many, without the records */
export function qualitySummary(issues: Issue[]) {
  return issues.map((i) => ({ effect: i.effect, table: i.table, issue: i.title, records: i.records.length, rule: i.rule, examples: i.records.slice(0, 3).map((r) => `${r.id}: ${r.detail}`) }));
}
