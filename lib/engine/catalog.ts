import { z } from "zod";
import type { Dataset } from "./types";
import * as M from "./metrics";
import { query, QUERY_DATASETS, QUERY_DEFS, QUERY_OPS, type QuerySpec } from "./query";
import { actionList, COHORT_KEYS, type Cohort } from "./actions";
import { whatIf, type WhatIfSpec } from "./whatif";
import { TICKET_STATUSES, TICKET_TEAMS, ticketsView, type TicketTeam } from "./tickets";
import type { TicketStatus } from "./types";
import { viewAsOf } from "./view";
import { resolveAsOf } from "./time";

const asOf = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/)
  .describe("As-of date YYYY-MM-DD (end of that day IST) or an ISO timestamp. Leave out to use the date selected on screen. Later dates are not available.");

/**
 * Every engine function the copilot may call. Calculations live here, never in the LLM.
 * The copilot session turns these into Gemini function declarations (z.toJSONSchema).
 */
export const catalog = {
  funnel: {
    description: "Growth funnel (identified, started registration, registered, confirmed, attended) plus walk-ins, no-shows and the biggest leak.",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.funnel(d, a.asOf),
  },
  targetsVsActuals: {
    description: "Goals in force vs actuals: identified, registered, verified visitors (projected before the event), spend vs budget.",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.targetsVsActuals(d, a.asOf),
  },
  campaignTable: {
    description: "Per-campaign KPIs: spend, identified, registered, confirmed, attended, show-up %, INR per registration / confirmed / actual attendee, share of spend vs attendees, engaged share, plan budget and status.",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.campaignTable(d, a.asOf),
  },
  pace: {
    description: "Daily cumulative registrations vs a linear target line, average daily rate over the last 7 days and the rate required to reach the goal.",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.pace(d, a.asOf),
  },
  projection: {
    description: "Before the event: projected verified visitors (low/mid/high) from confirmed registrants and Settings assumptions. After: the actual and the error of the day-before projection.",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.projection(d, a.asOf),
  },
  flags: {
    description: "Scale / watch / stop flag for each campaign with a plain-English reason and the numbers behind it.",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.flags(d, a.asOf),
  },
  dataHealth: {
    description: "Data quality: duplicate IDs per table, conflicting duplicates, denied/pending/unverified scans, non-external admissions, negative spend rows, unattributed visitors.",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.dataHealth(d, a.asOf),
  },
  registrationStatus: {
    description: "Count of registrations by latest status (interested, confirmed, cancelled, waitlisted) at a time. scope 'all' includes internal registrations.",
    input: z.object({ asOf, scope: z.enum(["external", "all"]).optional() }),
    run: (d: Dataset, a: { asOf: string; scope?: "external" | "all" }) => M.registrationStatus(d, a.asOf, { scope: a.scope }),
  },
  person: {
    description: "One person's profile, registrations, attendance and full timeline. Look up by person_id (names repeat).",
    input: z.object({ personId: z.string(), asOf }),
    run: (d: Dataset, a: { personId: string; asOf: string }) => M.person(d, a.personId, a.asOf),
  },
  searchPeople: {
    description: "Search people by name or person_id; returns matches with type, campaign, latest status, attended and engaged.",
    input: z.object({ asOf, q: z.string(), page: z.number().int().min(1).optional() }),
    run: (d: Dataset, a: { asOf: string; q: string; page?: number }) => M.peopleDirectory(d, a.asOf, { q: a.q, page: a.page, pageSize: 25 }),
  },
  dailyCampaign: {
    description: "Daily marketing rows for one campaign: spend, impressions, clicks, reach, sessions, registration starts (anonymous counts).",
    input: z.object({ campaignId: z.string(), asOf }),
    run: (d: Dataset, a: { campaignId: string; asOf: string }) => M.dailyCampaign(d, a.campaignId, a.asOf),
  },
  momentum: {
    description: "What is driving change: registrations and spend per campaign in the last N days vs the N days before, plus recent data edits.",
    input: z.object({ asOf, windowDays: z.number().int().min(1).max(60).optional() }),
    run: (d: Dataset, a: { asOf: string; windowDays?: number }) => M.momentum(d, a.asOf, { windowDays: a.windowDays }),
  },
  showupDrivers: {
    description: "After the event: show-up rate by engagement type and by registration lead time (associations, not causes).",
    input: z.object({ asOf }),
    run: (d: Dataset, a: { asOf: string }) => M.showupDrivers(d, a.asOf),
  },
  tasks: {
    description: "Tasks with owner, team, due date, status and overdue flag; optional filters.",
    input: z.object({
      asOf,
      status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
      campaign_id: z.string().optional(),
      owner_id: z.string().optional(),
      overdueOnly: z.boolean().optional(),
    }),
    run: (d: Dataset, a: { asOf: string; status?: string; campaign_id?: string; owner_id?: string; overdueOnly?: boolean }) => M.tasksView(d, a.asOf, a),
  },
  tickets: {
    description: "Requests between the festival's own teams (publicity, sponsorship, events): who asked whom for what, status, needed-by date, history and linked tasks. Pass ticketId, or filter to three tickets or fewer, to read the details. You cannot create or change tickets.",
    input: z.object({ asOf, team: z.enum(TICKET_TEAMS).optional(), status: z.enum(TICKET_STATUSES).optional(), ticketId: z.string().max(60).optional() }),
    run: (d: Dataset, a: { asOf: string; team?: TicketTeam; status?: TicketStatus; ticketId?: string }) => ticketsView(d, a.asOf, a),
  },
  query: {
    description:
      "Slice and count the data for questions the other tools do not cover. For the busiest or biggest group (an hour, a day, a campaign), group by that field and read largestGroup, which covers every group whatever the order or limit. To count people by how many event days they came, use dataset people with the field days_attended. " +
      QUERY_DATASETS.map((k) => `Dataset ${k}: fields ${Object.entries(QUERY_DEFS[k].fields).map(([f, h]) => `${f} (${h})`).join(", ")}; measures ${Object.keys(QUERY_DEFS[k].measures).join(", ")}.`).join(" "),
    input: z.object({
      asOf,
      dataset: z.enum(QUERY_DATASETS),
      filters: z.array(z.object({ field: z.string(), op: z.enum(QUERY_OPS), values: z.array(z.string()).min(1) })).max(8).optional(),
      groupBy: z.array(z.string()).max(2).optional(),
      measures: z.array(z.string()).max(6).optional(),
      limit: z.number().int().min(1).max(60).optional(),
    }),
    run: (d: Dataset, a: QuerySpec) => query(d, a),
  },
  actionList: {
    description: "Who to act on: confirmed people who asked no question, interested but not confirmed, waitlisted, and people who failed a gate scan and were never admitted. Gives counts, campaign split and a few examples. Leave cohort out for all group sizes.",
    input: z.object({ asOf, cohort: z.enum(COHORT_KEYS as [Cohort, ...Cohort[]]).optional() }),
    run: (d: Dataset, a: { asOf: string; cohort?: Cohort }) => actionList(d, a.asOf, a.cohort),
  },
  whatIf: {
    description:
      "Simulate budget moves between campaigns, a cut to the whole budget, and/or a different show-up rate among confirmed registrants. Returns a cautious-to-optimistic range with its assumptions. Before the event only the unspent budget can change, a percentage is of the budget, and the result is a change with no new total. Always use this for 'what if' questions instead of calculating yourself.",
    input: z.object({
      asOf,
      moves: z.array(z.object({ from: z.string().optional(), to: z.string().optional(), inr: z.number() })).max(10).optional(),
      budgetChangePct: z.number().min(-100).max(100).optional(),
      budgetChangeInr: z.number().optional(),
      cutStrategy: z.enum(["proportional", "costliest_first"]).optional(),
      confirmedShowUpPct: z.number().min(0).max(100).optional(),
      capacityAttendees: z.number().int().positive().optional(),
    }),
    run: (d: Dataset, a: WhatIfSpec) => whatIf(d, a),
  },
  eventInfo: {
    description: "Event dates, history window and every target version.",
    input: z.object({}),
    run: (d: Dataset) => M.eventInfo(d),
  },
} as const;

export type ToolName = keyof typeof catalog;

/** Typed dispatcher: validate args with zod, run the engine, return { ok, result | error }. */
export function executeTool(data: Dataset, name: string, args: unknown) {
  const entry = (catalog as unknown as Record<string, { input: z.ZodTypeAny; run: (d: Dataset, a: never) => unknown }>)[name];
  if (!entry) return { ok: false as const, error: `Unknown tool '${name}'. Available: ${Object.keys(catalog).join(", ")}` };
  const parsed = entry.input.safeParse(args ?? {});
  if (!parsed.success) return { ok: false as const, error: `Invalid arguments for ${name}: ${parsed.error.message}` };
  try {
    return { ok: true as const, result: entry.run(data, parsed.data as never) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The copilot's entry point: every call sees only data up to the date selected on screen,
 * and a requested date after it is pulled back to it.
 */
export function executeToolAsOf(data: Dataset, name: string, args: unknown, selectedDate: string) {
  const view = viewAsOf(data, selectedDate);
  const given = (args && typeof args === "object" ? { ...(args as Record<string, unknown>) } : {}) as Record<string, unknown>;
  let capped = false;
  let asOfUsed = selectedDate;
  if (typeof given.asOf === "string" && given.asOf) {
    try {
      if (resolveAsOf(given.asOf).ms > resolveAsOf(selectedDate).ms) capped = true;
      else asOfUsed = given.asOf;
    } catch {
      asOfUsed = selectedDate;
    }
  }
  const out = executeTool(view, name, { ...given, asOf: asOfUsed });
  if (out.ok && capped) {
    const result = out.result as { caveats?: string[] };
    return { ok: true as const, asOfUsed, result: { ...result, caveats: [`A date after the selected date (${selectedDate}) was requested. Later data is not available, so ${selectedDate} was used.`, ...(result.caveats ?? [])] } };
  }
  return { ...out, asOfUsed };
}
