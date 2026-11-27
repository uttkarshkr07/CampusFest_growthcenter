// Tickets between teams. A ticket is read as it stood at the end of the selected day: later status
// changes, comments and edits do not exist yet.
import { addDays, daysBetween, resolveAsOf, istDay } from "./time";
import type { Dataset, Result, TicketEventRow, TicketRow, TicketStatus } from "./types";

export const TICKET_TEAMS = ["publicity", "sponsorship", "events"] as const;
export type TicketTeam = (typeof TICKET_TEAMS)[number];
export const TICKET_STATUSES = ["open", "accepted", "declined", "in_progress", "done"] as const;
export const STATUS_LABEL: Record<TicketStatus, string> = { open: "Open", accepted: "Accepted", declined: "Declined", in_progress: "In progress", done: "Done" };
/** what the receiving team can do next from each status */
export const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = { open: ["accepted", "declined"], accepted: ["in_progress"], in_progress: ["done"], declined: [], done: [] };

const STATUS_KINDS: readonly string[] = ["accepted", "declined", "in_progress", "done"];
const day = (iso: string) => String(iso).slice(0, 10);

export interface TicketAtDate extends TicketRow {
  /** status at the selected date */
  status: TicketStatus;
  events: TicketEventRow[];
  declineReason: string | null;
  finished: boolean;
  overdue: boolean;
  daysLeft: number | null;
}

function atDate(ticket: TicketRow, events: TicketEventRow[], asOfDay: string): TicketAtDate {
  const own = events.filter((e) => e.ticket_id === ticket.id).sort((a, b) => Number(a.id) - Number(b.id));
  const visible = own.filter((e) => day(e.story_date) <= asOfDay);
  const moves = visible.filter((e) => STATUS_KINDS.includes(e.kind));
  const status = (moves[moves.length - 1]?.kind ?? "open") as TicketStatus;
  // an edit made after this date has not happened yet: show the request as it was before the first such edit
  const laterEdit = own.find((e) => e.kind === "edited" && day(e.story_date) > asOfDay && e.before);
  const content = laterEdit?.before ?? {};
  const merged = { ...ticket, ...content };
  const finished = status === "done" || status === "declined";
  const neededBy = merged.needed_by ? day(merged.needed_by) : null;
  return {
    ...merged,
    status,
    events: visible.map((e) => ({ ...e, before: null })),
    declineReason: status === "declined" ? (moves[moves.length - 1]?.body ?? null) : null,
    finished,
    overdue: !finished && !!neededBy && neededBy < asOfDay,
    daysLeft: !finished && neededBy ? daysBetween(asOfDay, neededBy) : null,
  };
}

export function ticketsAt(data: Dataset, asOf: string): TicketAtDate[] {
  const { ms, day: asOfDay } = resolveAsOf(asOf);
  const today = asOfDay || istDay(ms);
  return (data.tickets ?? [])
    .filter((t) => day(t.raised_on) <= today)
    .map((t) => atDate(t, data.ticket_events ?? [], today))
    .sort((a, b) => Number(a.finished) - Number(b.finished) || day(a.needed_by ?? addDays(today, 3650)).localeCompare(day(b.needed_by ?? addDays(today, 3650))) || day(a.raised_on).localeCompare(day(b.raised_on)));
}

/** open tickets that one of these teams still has to accept or decline */
export function awaiting(tickets: TicketAtDate[], teams: readonly string[]): TicketAtDate[] {
  return tickets.filter((t) => t.status === "open" && teams.includes(t.to_team));
}

export function ticketSummary(data: Dataset, asOf: string) {
  const all = ticketsAt(data, asOf);
  return {
    total: all.length,
    byStatus: Object.fromEntries(TICKET_STATUSES.map((s) => [s, all.filter((t) => t.status === s).length])),
    awaitingByTeam: Object.fromEntries(TICKET_TEAMS.map((team) => [team, awaiting(all, [team]).length])),
    overdue: all.filter((t) => t.overdue).length,
  };
}

/** The copilot's view. Ticket text is data written by people; a simulated ticket always carries its label. */
export function ticketsView(data: Dataset, asOf: string, filter: { team?: TicketTeam; status?: TicketStatus; ticketId?: string } = {}) {
  const { day: asOfDay } = resolveAsOf(asOf);
  const name = new Map((data.team ?? []).map((m) => [m.owner_id, m.owner_name]));
  const matching = ticketsAt(data, asOf).filter(
    (t) => (!filter.ticketId || t.id === filter.ticketId) && (!filter.team || t.to_team === filter.team || t.from_team === filter.team) && (!filter.status || t.status === filter.status),
  );
  const detail = matching.length <= 3;
  const rows = matching.slice(0, 15).map((t) => ({
    id: t.id,
    label: t.simulation_note,
    title: t.title,
    from: t.from_team,
    to: t.to_team,
    priority: t.priority,
    status: t.status,
    declineReason: t.declineReason,
    raisedOn: day(t.raised_on),
    neededBy: t.needed_by ? day(t.needed_by) : null,
    overdue: t.overdue,
    assignedTo: t.assignee_id ? (name.get(t.assignee_id) ?? t.assignee_id) : null,
    details: detail ? t.details : null,
    history: detail ? t.events.map((e) => ({ date: day(e.story_date), what: e.kind, by: e.actor_name, note: e.body })) : null,
    linkedTasks: (data.tasks ?? []).filter((x) => x.ticket_id === t.id).map((x) => ({ title: x.title, status: x.status, owner: x.owner_id ? (name.get(x.owner_id) ?? x.owner_id) : null })),
  }));
  const caveats: string[] = [];
  if (!detail) caveats.push("Details and history are left out of long lists. Ask for one ticket by its ID to read them.");
  if (matching.length > rows.length) caveats.push(`Only ${rows.length} of ${matching.length} tickets are listed.`);
  for (const note of new Set(rows.map((r) => r.label).filter((x): x is string => !!x))) caveats.push(`A ticket here is marked: ${note}`);
  return {
    value: { asOf: asOfDay, total: matching.length, tickets: rows },
    basis: ["Tickets are requests between teams, entered in this app. They are not records from the datasets.", "Each ticket is shown as it stood at the end of the selected day."],
    caveats,
  } satisfies Result<unknown>;
}
