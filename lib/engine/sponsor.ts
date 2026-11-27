// Sponsor acquisition, view only. Same rules as the attendee engine: a selected date means the end
// of that day in IST, nothing later is read, repeated IDs count once, and a history is read as its
// latest version, never summed. Every figure returns {value, basis, caveats}.
import { z } from "zod";
import { dedupe, type DedupStat } from "./prepare";
import { daysBetween, istDay, resolveAsOf, toMs } from "./time";
import type { Result, SponsorActivationRow } from "./types";

export interface SponsorTarget {
  effective_at: string;
  qualified_brands_goal: number;
  confirmed_partnerships_goal: number;
  target_version: string;
}
export interface SponsorBrand {
  brand_id: string;
  brand_name: string;
  industry: string | null;
  owner_id: string | null;
  owner_name: string | null;
  created_at: string;
}
export interface SponsorContact {
  contact_id: string;
  brand_id: string;
  contact_name: string;
  job_title: string | null;
  created_at: string;
}
export interface SponsorCampaign {
  sponsor_campaign_id: string;
  campaign_name: string;
  channel: string | null;
  objective: string | null;
  audience: string | null;
  owner_id: string | null;
  owner_name: string | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  created_at: string;
}
export interface SponsorInteraction {
  interaction_id: string;
  attempt_id: string;
  brand_id: string;
  contact_id: string;
  sponsor_campaign_id: string;
  channel: string;
  event_type: string;
  outcome: string | null;
  summary: string | null;
  occurred_at: string;
}
export interface Qualification {
  history_id: string;
  brand_id: string;
  qualification_status: string;
  reason: string | null;
  sponsor_campaign_id: string | null;
  effective_at: string;
}
export interface Opportunity {
  opportunity_id: string;
  opportunity_name: string;
  brand_id: string;
  primary_contact_id: string | null;
  sponsor_campaign_id: string | null;
  support_type: string | null;
  created_at: string;
}
export interface OpportunityVersion {
  history_id: string;
  opportunity_id: string;
  brand_id: string;
  stage: string;
  proposed_value_inr: number | null;
  confirmed_value_inr: number | null;
  owner_id: string | null;
  owner_name: string | null;
  effective_at: string;
}

export interface SponsorData {
  targets: SponsorTarget[];
  brands: SponsorBrand[];
  contacts: SponsorContact[];
  campaigns: SponsorCampaign[];
  interactions: SponsorInteraction[];
  qualification: Qualification[];
  opportunities: Opportunity[];
  opportunity_history: OpportunityVersion[];
  activations: SponsorActivationRow[];
}

export const SPONSOR_SHEETS = ["targets", "brands", "contacts", "campaigns", "interactions", "qualification", "opportunities", "opportunity_history", "activations"] as const;

export const STAGES = ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed", "lost", "withdrawn"] as const;
const OPEN_STAGES: readonly string[] = ["prospecting", "contacted", "proposal_sent", "negotiating"];
export const QUALIFICATIONS = ["unreviewed", "engaged", "qualified", "unqualified", "dormant"] as const;
/** the events that start a conversation; everything else follows from one of these */
const ROOT_TOUCH = new Set(["outreach_sent", "introduction_received", "web_inbound"]);

const DEF = {
  asOf: "As-of = end of the selected day in IST; sponsor records after it are not read.",
  dedup: "Rows with identical interaction or history IDs are import copies and count once.",
  qualified: "Qualified brand = a brand whose LATEST qualification version is 'qualified'.",
  confirmed: "Confirmed partnership = an opportunity whose LATEST stage is 'partner_confirmed'.",
  attempts: "Attempts, contacts and brands are different counts. One brand can have several contacts, and one contact several attempts.",
};
const CAVEAT = {
  value: "Sponsorship values are reported amounts (cash and in-kind together at face value), NOT cash received. The data records no payments.",
  separate: "Qualification and opportunity stage are separate records. A positive reply is neither.",
  association: "The campaign on a record shows association, not that the campaign caused the outcome.",
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const uniq = <T, K>(xs: T[], key: (x: T) => K) => new Set(xs.map(key)).size;

/** latest version per key; versions with the same time are ordered by history ID */
function latestBy<T extends { effective_at: string; history_id: string }>(rows: T[], key: (r: T) => string): Map<string, T> {
  const ordered = [...rows].sort((a, b) => toMs(a.effective_at) - toMs(b.effective_at) || a.history_id.localeCompare(b.history_id));
  return new Map(ordered.map((r) => [key(r), r]));
}

interface Snap {
  asOfMs: number;
  day: string;
  label: string;
  goal: SponsorTarget | null;
  brands: SponsorBrand[];
  brandById: Map<string, SponsorBrand>;
  contacts: SponsorContact[];
  campaigns: SponsorCampaign[];
  interactions: SponsorInteraction[];
  qualification: Qualification[];
  qualNow: Map<string, Qualification>;
  opportunities: Opportunity[];
  history: OpportunityVersion[];
  oppNow: Map<string, OpportunityVersion>;
  activations: SponsorActivationRow[];
  dedup: DedupStat[];
  warnings: string[];
}

const cache = new WeakMap<SponsorData, Map<number, Snap>>();

function snapshot(data: SponsorData, asOf: string): Snap {
  const { ms, day, label } = resolveAsOf(asOf);
  let byDate = cache.get(data);
  if (!byDate) cache.set(data, (byDate = new Map()));
  const hit = byDate.get(ms);
  if (hit) return hit;

  const upTo = <T>(rows: T[], when: (r: T) => string | null) => rows.filter((r) => toMs(when(r)) <= ms);
  const i = dedupe(upTo(data.interactions, (r) => r.occurred_at), "interaction_id", "sponsor_interactions");
  const q = dedupe(upTo(data.qualification, (r) => r.effective_at), "history_id", "brand_qualification");
  const h = dedupe(upTo(data.opportunity_history, (r) => r.effective_at), "history_id", "opportunity_history");
  const brands = upTo(data.brands, (r) => r.created_at);
  const targets = upTo(data.targets, (r) => r.effective_at).sort((a, b) => toMs(a.effective_at) - toMs(b.effective_at));
  const dedup = [i.stat, q.stat, h.stat];
  const snap: Snap = {
    asOfMs: ms,
    day: day || istDay(ms),
    label,
    goal: targets[targets.length - 1] ?? null,
    brands,
    brandById: new Map(brands.map((b) => [b.brand_id, b])),
    contacts: upTo(data.contacts, (r) => r.created_at),
    campaigns: upTo(data.campaigns, (r) => r.created_at),
    interactions: i.rows,
    qualification: q.rows,
    qualNow: latestBy(q.rows, (r) => r.brand_id),
    opportunities: upTo(data.opportunities, (r) => r.created_at),
    history: h.rows,
    oppNow: latestBy(h.rows, (r) => r.opportunity_id),
    activations: upTo(data.activations, (r) => r.linked_at),
    dedup,
    warnings: dedup.filter((d) => d.conflictingIds.length).map((d) => `${d.table}: ${d.conflictingIds.length} ID(s) repeat with different contents; the last row is used.`),
  };
  byDate.set(ms, snap);
  return snap;
}

const brandsOf = (rows: SponsorInteraction[], keep: (r: SponsorInteraction) => boolean) => new Set(rows.filter(keep).map((r) => r.brand_id));
const qualifiedIds = (s: Snap) => new Set([...s.qualNow.values()].filter((q) => q.qualification_status === "qualified").map((q) => q.brand_id));

export function sponsorOverview(data: SponsorData, asOf: string) {
  const s = snapshot(data, asOf);
  const latest = s.opportunities.map((o) => ({ o, now: s.oppNow.get(o.opportunity_id) }));
  const stages = STAGES.map((stage) => {
    const at = latest.filter((x) => x.now?.stage === stage);
    return { stage, opportunities: at.length, proposedValueInr: sum(at.map((x) => Number(x.now!.proposed_value_inr ?? 0))), confirmedValueInr: stage === "partner_confirmed" ? sum(at.map((x) => Number(x.now!.confirmed_value_inr ?? 0))) : 0 };
  });
  const confirmed = latest.filter((x) => x.now?.stage === "partner_confirmed");
  const confirmedOf = (type: string) => sum(confirmed.filter((x) => x.o.support_type === type).map((x) => Number(x.now!.confirmed_value_inr ?? 0)));
  const qualified = qualifiedIds(s);
  const touched = brandsOf(s.interactions, (r) => ROOT_TOUCH.has(r.event_type));
  const replied = brandsOf(s.interactions, (r) => r.event_type === "replied");
  const confirmedBrands = new Set(confirmed.map((x) => x.o.brand_id));
  const target = (label: string, actual: number, goal: number | null) => ({ label, goal, actual, gap: goal == null ? null : Math.max(0, goal - actual), pctOfGoal: goal ? Math.round((actual / goal) * 1000) / 10 : null });
  return {
    value: {
      asOf: s.label,
      targetVersion: s.goal?.target_version ?? null,
      targets: [target("Qualified brands", qualified.size, s.goal?.qualified_brands_goal ?? null), target("Confirmed partnerships", confirmed.length, s.goal?.confirmed_partnerships_goal ?? null)],
      brands: {
        onRecord: s.brands.length,
        withAnyTouch: touched.size,
        replied: replied.size,
        withPositiveReply: brandsOf(s.interactions, (r) => r.event_type === "replied" && r.outcome === "positive").size,
        sentInboundInterest: brandsOf(s.interactions, (r) => r.event_type === "web_inbound").size,
        meetingHeld: brandsOf(s.interactions, (r) => r.event_type === "meeting_held").size,
        qualifiedNow: qualified.size,
        withOpportunity: uniq(s.opportunities, (o) => o.brand_id),
        withConfirmedPartnership: confirmedBrands.size,
      },
      activity: {
        attempts: uniq(s.interactions, (r) => r.attempt_id),
        contactsInvolved: uniq(s.interactions, (r) => r.contact_id),
        events: s.interactions.length,
        contactsOptedOut: uniq(s.interactions.filter((r) => r.event_type === "opt_out"), (r) => r.contact_id),
      },
      qualificationNow: QUALIFICATIONS.map((status) => ({ status, brands: [...s.qualNow.values()].filter((q) => q.qualification_status === status).length })),
      stages,
      reportedValue: {
        confirmedInr: sum(stages.map((x) => x.confirmedValueInr)),
        confirmedCashTypeInr: confirmedOf("cash"),
        confirmedInKindInr: confirmedOf("in_kind"),
        openProposedInr: sum(stages.filter((x) => OPEN_STAGES.includes(x.stage)).map((x) => x.proposedValueInr)),
      },
      dataQuality: s.dedup.map((d) => ({ table: d.table, rows: d.raw, unique: d.unique, identicalCopies: d.identicalCopies })),
    },
    basis: [DEF.asOf, DEF.dedup, DEF.qualified, DEF.confirmed, DEF.attempts],
    caveats: [CAVEAT.value, CAVEAT.separate, "The brand counts are separate populations, not one funnel: a brand can reach a later one without appearing in an earlier one.", ...s.warnings],
  } satisfies Result<unknown>;
}

export function sponsorCampaigns(data: SponsorData, asOf: string) {
  const s = snapshot(data, asOf);
  const qualified = qualifiedIds(s);
  const rows = s.campaigns.map((c) => {
    const own = s.interactions.filter((r) => r.sponsor_campaign_id === c.sponsor_campaign_id);
    const opps = s.opportunities.filter((o) => o.sponsor_campaign_id === c.sponsor_campaign_id);
    const won = opps.map((o) => s.oppNow.get(o.opportunity_id)).filter((v) => v?.stage === "partner_confirmed");
    return {
      id: c.sponsor_campaign_id,
      name: c.campaign_name,
      channel: c.channel,
      owner: c.owner_name,
      attempts: uniq(own, (r) => r.attempt_id),
      brandsTouched: brandsOf(own, (r) => ROOT_TOUCH.has(r.event_type)).size,
      brandsReplied: brandsOf(own, (r) => r.event_type === "replied").size,
      brandsMeetingHeld: brandsOf(own, (r) => r.event_type === "meeting_held").size,
      qualifiedBrands: [...qualified].filter((id) => s.qualNow.get(id)!.sponsor_campaign_id === c.sponsor_campaign_id).length,
      opportunities: opps.length,
      confirmedPartnerships: won.length,
      reportedConfirmedInr: sum(won.map((v) => Number(v!.confirmed_value_inr ?? 0))),
    };
  });
  return {
    value: { asOf: s.label, rows },
    basis: [DEF.asOf, DEF.dedup, DEF.attempts, "Qualified brands are credited to the campaign named on their latest qualification version; opportunities to the campaign recorded when they were created."],
    caveats: [CAVEAT.association, CAVEAT.value, "A brand can be touched by several campaigns, so brand counts do not add up across campaigns.", "The data has no sponsor campaign spend, so cost per outcome cannot be calculated.", ...s.warnings],
  } satisfies Result<unknown>;
}

export function sponsorOpportunities(data: SponsorData, asOf: string, filter: { stage?: string; search?: string } = {}) {
  const s = snapshot(data, asOf);
  const campaign = new Map(s.campaigns.map((c) => [c.sponsor_campaign_id, c.campaign_name]));
  const needle = filter.search?.trim().toLowerCase();
  const rows = s.opportunities
    .flatMap((o) => {
      const now = s.oppNow.get(o.opportunity_id);
      if (!now) return [];
      const brand = s.brandById.get(o.brand_id)?.brand_name ?? o.brand_id;
      return [
        {
          id: o.opportunity_id,
          name: o.opportunity_name,
          brandId: o.brand_id,
          brand,
          stage: now.stage,
          supportType: o.support_type,
          proposedValueInr: now.proposed_value_inr,
          confirmedValueInr: now.stage === "partner_confirmed" ? now.confirmed_value_inr : 0,
          owner: now.owner_name,
          lastUpdate: istDay(toMs(now.effective_at)),
          daysSinceUpdate: daysBetween(istDay(toMs(now.effective_at)), s.day),
          fromCampaign: o.sponsor_campaign_id ? (campaign.get(o.sponsor_campaign_id) ?? o.sponsor_campaign_id) : null,
        },
      ];
    })
    .filter((r) => (!filter.stage || r.stage === filter.stage) && (!needle || `${r.brand} ${r.name} ${r.owner ?? ""} ${r.id}`.toLowerCase().includes(needle)))
    .sort((a, b) => STAGES.indexOf(a.stage as never) - STAGES.indexOf(b.stage as never) || b.daysSinceUpdate - a.daysSinceUpdate || a.id.localeCompare(b.id));
  return {
    value: { asOf: s.label, total: rows.length, rows },
    basis: [DEF.asOf, DEF.dedup, "Each opportunity shows its latest version."],
    caveats: [CAVEAT.value, "Days since update is not by itself a sign that a deal is stalled; the data sets no follow-up deadline.", ...s.warnings],
  } satisfies Result<unknown>;
}

export function sponsorBrands(data: SponsorData, asOf: string, filter: { search?: string; qualification?: string } = {}) {
  const s = snapshot(data, asOf);
  const group = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return m;
  };
  const touches = group(s.interactions, (r) => r.brand_id);
  const contacts = group(s.contacts, (r) => r.brand_id);
  const opps = group(s.opportunities, (r) => r.brand_id);
  const needle = filter.search?.trim().toLowerCase();
  const rows = s.brands
    .map((b) => {
      const own = touches.get(b.brand_id) ?? [];
      const last = own.reduce((m, r) => Math.max(m, toMs(r.occurred_at)), 0);
      return {
        id: b.brand_id,
        brand: b.brand_name,
        industry: b.industry,
        owner: b.owner_name,
        qualification: s.qualNow.get(b.brand_id)?.qualification_status ?? null,
        contacts: contacts.get(b.brand_id)?.length ?? 0,
        attempts: uniq(own, (r) => r.attempt_id),
        replied: own.some((r) => r.event_type === "replied"),
        lastActivity: last ? istDay(last) : null,
        stages: (opps.get(b.brand_id) ?? []).map((o) => s.oppNow.get(o.opportunity_id)?.stage).filter((x): x is string => !!x),
      };
    })
    .filter((r) => (!filter.qualification || r.qualification === filter.qualification) && (!needle || `${r.brand} ${r.owner ?? ""} ${r.industry ?? ""} ${r.id}`.toLowerCase().includes(needle)));
  return {
    value: { asOf: s.label, total: rows.length, rows },
    basis: [DEF.asOf, DEF.dedup, DEF.qualified],
    caveats: [CAVEAT.separate, ...s.warnings],
  } satisfies Result<unknown>;
}

/** One brand: its contacts and everything recorded about it, oldest first. */
export function sponsorBrand(data: SponsorData, asOf: string, brand: string) {
  const s = snapshot(data, asOf);
  const wanted = brand.trim().toLowerCase();
  const matches = s.brands.filter((b) => b.brand_id.toLowerCase() === wanted || b.brand_name.toLowerCase() === wanted);
  const found = matches.length === 1 ? matches[0] : null;
  if (!found)
    return {
      value: null,
      basis: [DEF.asOf],
      caveats: [`No brand with the ID or exact name '${brand}' exists at this date. Use the brands report with a search to find it.`],
    } satisfies Result<null>;
  const person = new Map(s.contacts.map((c) => [c.contact_id, c.contact_name]));
  const timeline = [
    ...s.interactions.filter((r) => r.brand_id === found.brand_id).map((r) => ({ at: r.occurred_at, kind: "interaction", what: `${r.event_type} (${r.outcome ?? "no outcome"})`, who: person.get(r.contact_id) ?? r.contact_id, note: r.summary })),
    ...s.qualification.filter((r) => r.brand_id === found.brand_id).map((r) => ({ at: r.effective_at, kind: "qualification", what: r.qualification_status, who: null, note: r.reason })),
    ...s.history.filter((r) => r.brand_id === found.brand_id).map((r) => ({ at: r.effective_at, kind: "opportunity", what: `${r.opportunity_id}: ${r.stage}`, who: r.owner_name, note: null })),
  ].sort((a, b) => toMs(a.at) - toMs(b.at));
  const names = new Map(s.opportunities.map((o) => [o.opportunity_id, o]));
  return {
    value: {
      asOf: s.label,
      brand: { id: found.brand_id, name: found.brand_name, industry: found.industry, owner: found.owner_name },
      qualification: s.qualNow.get(found.brand_id)?.qualification_status ?? null,
      contacts: s.contacts.filter((c) => c.brand_id === found.brand_id).map((c) => ({ id: c.contact_id, name: c.contact_name, title: c.job_title })),
      opportunities: [...names.values()]
        .filter((o) => o.brand_id === found.brand_id)
        .map((o) => ({ id: o.opportunity_id, name: o.opportunity_name, supportType: o.support_type, stage: s.oppNow.get(o.opportunity_id)?.stage ?? null, proposedValueInr: s.oppNow.get(o.opportunity_id)?.proposed_value_inr ?? null })),
      timeline,
    },
    basis: [DEF.asOf, DEF.dedup],
    caveats: [CAVEAT.separate, CAVEAT.value, ...s.warnings],
  } satisfies Result<unknown>;
}

export function sponsorActivations(data: SponsorData, asOf: string) {
  const s = snapshot(data, asOf);
  return {
    value: { asOf: s.label, rows: [...s.activations].sort((a, b) => toMs(a.linked_at) - toMs(b.linked_at)) },
    basis: [DEF.asOf, "An activation links a sponsor opportunity to one attendee campaign."],
    caveats: ["An activation is an association. It does not show that the sponsor added any visitors.", ...s.warnings],
  } satisfies Result<unknown>;
}

export const SPONSOR_REPORTS = ["overview", "campaigns", "opportunities", "brands", "brand", "activations"] as const;
export const sponsorToolInput = z.object({
  asOf: z.string().optional(),
  report: z.enum(SPONSOR_REPORTS),
  search: z.string().max(80).optional(),
  stage: z.enum(STAGES).optional(),
  qualification: z.enum(QUALIFICATIONS).optional(),
});
/** keeps a long list from filling the model's request */
const MODEL_ROWS = 25;

/** The copilot's entry point: a date after the selected one is pulled back to it. */
export function executeSponsorTool(data: SponsorData | null, args: unknown, selectedDate: string) {
  if (!data) return { ok: false as const, asOfUsed: selectedDate, error: "Sponsor data is not loaded, so sponsor questions cannot be answered right now." };
  const parsed = sponsorToolInput.safeParse(args ?? {});
  if (!parsed.success) return { ok: false as const, asOfUsed: selectedDate, error: `Invalid arguments for the sponsor tool: ${parsed.error.message}` };
  const a = parsed.data;
  let asOfUsed = selectedDate;
  let capped = false;
  if (a.asOf) {
    try {
      if (resolveAsOf(a.asOf).ms > resolveAsOf(selectedDate).ms) capped = true;
      else asOfUsed = a.asOf;
    } catch {
      /* an unreadable date falls back to the selected one */
    }
  }
  const run = (): Result<unknown> => {
    switch (a.report) {
      case "overview":
        return sponsorOverview(data, asOfUsed);
      case "campaigns":
        return sponsorCampaigns(data, asOfUsed);
      case "opportunities": {
        const r = sponsorOpportunities(data, asOfUsed, a);
        return r.value.total > MODEL_ROWS ? { ...r, value: { ...r.value, rows: r.value.rows.slice(0, MODEL_ROWS) }, caveats: [`Only ${MODEL_ROWS} of ${r.value.total} opportunities are listed. Filter by stage or search.`, ...r.caveats] } : r;
      }
      case "brands": {
        const r = sponsorBrands(data, asOfUsed, a);
        return r.value.total > MODEL_ROWS ? { ...r, value: { ...r.value, rows: r.value.rows.slice(0, MODEL_ROWS) }, caveats: [`Only ${MODEL_ROWS} of ${r.value.total} brands are listed. Search or filter to narrow it.`, ...r.caveats] } : r;
      }
      case "brand":
        return sponsorBrand(data, asOfUsed, a.search ?? "");
      case "activations":
        return sponsorActivations(data, asOfUsed);
    }
  };
  const result = run();
  return { ok: true as const, asOfUsed, result: capped ? { ...result, caveats: [`A date after the selected date (${selectedDate}) was requested. Later data is not available, so ${selectedDate} was used.`, ...result.caveats] } : result };
}
