// The compact brief sent with every copilot question, so common questions need one model request.
// Everything here is computed by the engine from current data; nothing is written by hand.
import { campaignTable, DEF, flags, funnel, pace, projection, tasksView, targetsVsActuals } from "./metrics";
import { prepare } from "./prepare";
import { daysBetween, resolveAsOf } from "./time";
import { SOURCE_TABLES, type Dataset } from "./types";
import { viewAsOf } from "./view";

/** Which tables and fields exist right now, so "the data cannot answer" follows the data, not a fixed list. */
function availability(view: Dataset) {
  const out: Record<string, { rows: number; fields: string[] }> = {};
  for (const table of SOURCE_TABLES) {
    const rows = (view[table] ?? []) as unknown as Record<string, unknown>[];
    out[table] = { rows: rows.length, fields: rows.length ? Object.keys(rows[0]).filter((k) => !k.startsWith("_")) : [] };
  }
  return out;
}

export function buildSummary(data: Dataset, asOf: string) {
  const view = viewAsOf(data, asOf);
  const p = prepare(view);
  const t = targetsVsActuals(view, asOf);
  const f = funnel(view, asOf);
  const c = campaignTable(view, asOf);
  const fl = flags(view, asOf);
  const phase = f.value.phase;
  const proj = phase === "pre-event" ? projection(view, asOf) : null;
  const speed = phase === "pre-event" ? pace(view, asOf) : null;
  const tasks = tasksView(view, asOf).value;
  const caveats = [...new Set([...t.caveats, ...f.caveats, ...c.caveats, ...fl.caveats, ...(proj?.caveats ?? []), ...(speed?.caveats ?? [])])];

  return {
    selectedDate: asOf,
    phase,
    event: { name: p.event.name, firstDay: p.event.startDay, lastDay: p.event.endDay, daysUntilStart: Math.max(0, daysBetween(resolveAsOf(asOf).day, p.event.startDay)) },
    targetsVsActuals: {
      targetVersion: t.value.targetVersion?.name ?? null,
      columns: ["metric", "goal", "actual", "percentOfGoal", "gap", "isProjection"],
      rows: t.value.rows.map((r) => [r.label, r.goal, r.actual, r.pctOfGoal, r.gap, r.projected]),
      budgetRemaining: t.value.budgetRemaining,
    },
    funnel: {
      stages: f.value.stages.map((s) => [s.label, s.count]),
      walkIns: phase === "pre-event" ? null : f.value.walkIns,
      actualAttendees: phase === "pre-event" ? null : f.value.actualAttendees, // null = not known yet
      confirmedNoShows: f.value.confirmedNoShows,
      biggestLeak: f.value.biggestLeak,
      registrationStatusAtSnapshot: f.value.statusAtSnapshot,
    },
    campaigns: {
      columns: ["id", "name", "planStatus", "spend", "registered", "confirmed", "attended", "showUpPct", "inrPerRegistration", "inrPerConfirmed", "inrPerAttendee", "engagedSharePct"],
      rows: c.value.rows.map((r) => [r.campaign_id, r.campaign_name, r.app_status, r.spend, r.registered, r.confirmed, r.attended, r.showUpPct, r.inrPerRegistration, r.inrPerConfirmed, r.inrPerAttendee, r.engagedSharePct]),
      totals: c.value.totals,
      unattributed: c.value.unattributed,
    },
    flags: fl.value.flags.map((x) => ({ id: x.campaign_id, level: x.level, reason: x.reason })),
    registrationPace: speed
      ? { registered: speed.value.latest?.registered ?? null, targetLineToday: speed.value.latest?.targetLine ?? null, gapToLine: speed.value.gapToLine, registrationGoal: speed.value.latest?.goal ?? null, daysToEvent: speed.value.daysToEvent, avgDailyLast7: speed.value.avgDailyLast7, requiredDailyToGoal: speed.value.requiredDailyToGoal }
      : null,
    projection: proj ? { countsOnly: "people confirmed by the selected date; not a forecast of the final number", confirmedNow: proj.value.confirmedNow, low: proj.value.low, mid: proj.value.mid, high: proj.value.high, goal: proj.value.goal, assumptions: proj.value.assumptions } : null,
    tasks: { byStatus: tasks.byStatus, overdue: tasks.overdue },
    team: view.team.map((m) => ({ owner_id: m.owner_id, name: m.owner_name, team: m.team })),
    dataAvailable: availability(view),
    definitions: [DEF.attendee, DEF.registered, DEF.attribution, DEF.spend, DEF.showup],
    caveats,
  };
}

export type Summary = ReturnType<typeof buildSummary>;
