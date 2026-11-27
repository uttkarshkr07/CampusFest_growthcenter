// Strict hindsight. The copilot works on a copy of the data in which nothing later than the
// selected date exists, so a tool cannot leak it even if its own date filter misses something.
import { ticketsAt } from "./tickets";
import { istDay, resolveAsOf, toMs, endOfIstDay } from "./time";
import type { Dataset, TaskRow } from "./types";

const cache = new WeakMap<Dataset, Map<number, Dataset>>();

/** Rows with a missing or unreadable timestamp are kept; the engine decides what to do with them. */
const notAfter = (iso: string | null | undefined, ms: number) => {
  const t = toMs(iso ?? null);
  return !Number.isFinite(t) || t <= ms;
};

/** A task written from analysis of a later date would reveal that date's results. */
function taskVisible(t: TaskRow, day: string): boolean {
  const analysed = (t.origin_ref as { asOf?: unknown } | null)?.asOf;
  if (typeof analysed === "string" && analysed.slice(0, 10) > day) return false;
  const story = (t as { story_date?: string | null }).story_date;
  return !story || story.slice(0, 10) <= day;
}

export function viewAsOf(data: Dataset, asOf: string): Dataset {
  const { ms, day } = resolveAsOf(asOf);
  let byDate = cache.get(data);
  if (!byDate) cache.set(data, (byDate = new Map()));
  const hit = byDate.get(ms);
  if (hit) return hit;

  const campaigns = data.campaigns.filter((c) => notAfter(c.created_at, ms));
  const visibleCampaigns = new Set(campaigns.map((c) => c.campaign_id));
  const view: Dataset = {
    ...data,
    targets: data.targets.filter((t) => notAfter(t.effective_at, ms)),
    campaigns,
    campaign_plan: data.campaign_plan.filter((c) => visibleCampaigns.has(c.campaign_id)),
    daily_marketing: data.daily_marketing.filter((d) => {
      const end = endOfIstDay(String(d.activity_date).slice(0, 10));
      return !Number.isFinite(end) || end <= ms;
    }),
    people: data.people.filter((x) => notAfter(x.first_seen_at, ms)),
    interactions: data.interactions.filter((x) => notAfter(x.occurred_at, ms)),
    registrations: data.registrations.filter((x) => notAfter(x.registered_at, ms)),
    registration_history: data.registration_history.filter((x) => notAfter(x.effective_at, ms)),
    checkins: data.checkins.filter((x) => notAfter(x.occurred_at, ms)),
    sponsor_activations: data.sponsor_activations.filter((x) => notAfter(x.linked_at, ms)),
    tasks: data.tasks.filter((t) => taskVisible(t, day || istDay(ms))),
    // task entries in the change log carry task titles, which can quote later analysis
    change_log: data.change_log.filter((c) => c.table_name !== "tasks"),
    // each ticket as it stood then: later status changes, comments and edits are removed
    tickets: ticketsAt(data, asOf).map((t) => ({
      id: t.id,
      title: t.title,
      details: t.details,
      from_team: t.from_team,
      to_team: t.to_team,
      requester_id: t.requester_id,
      assignee_id: t.assignee_id,
      priority: t.priority,
      status: t.status,
      raised_on: t.raised_on,
      needed_by: t.needed_by,
      simulation_note: t.simulation_note,
    })),
    ticket_events: ticketsAt(data, asOf).flatMap((t) => t.events),
  };
  byDate.set(ms, view);
  return view;
}
