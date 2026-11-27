// The College Championship: points from competition results, checked against the position rule and
// the tie rule, and the Contingent Trophy for the most verified attendees from one college.
import { betsAsOf, isSet, numberOf, text, word } from "./betview";
import { snapshot } from "./metrics";
import type { Dataset, Result } from "./types";
import { resolveAsOf } from "./time";

/** share of the event's points for 1st to 5th; any lower place gets nothing */
export const POSITION_SHARE = [1, 0.6, 0.4, 0.2, 0.1];

/** teams tied at a position split the places they occupy: three tied for 3rd share 3rd, 4th and 5th */
export function tiePoints(eventPoints: number, position: number, tied: number): number {
  if (position < 1 || tied < 1) return 0;
  let share = 0;
  for (let place = position; place < position + tied; place++) share += POSITION_SHARE[place - 1] ?? 0;
  return (eventPoints * share) / tied;
}

export interface CollegeStanding {
  rank: number;
  college_id: string;
  name: string;
  points: number;
  firsts: number;
  results: { event_id: string; event: string; team: string; position: number; points: number }[];
  /** contingent route */
  registered: number;
  /** distinct contingent attendees; null before the fest */
  verified: number | null;
  /** largest contingent tier reached, 0 for none */
  tier: number;
}

export interface ChampionshipValue {
  asOf: string;
  available: boolean;
  standings: CollegeStanding[];
  /** the Contingent Trophy; more than one name means a tie; null until someone has attended */
  trophy: { colleges: { college_id: string; name: string }[]; verified: number } | null;
  resultsCount: number;
  pointsAwarded: number;
  /** recorded points that do not follow the rules */
  mismatches: string[];
}

/** standard competition ranking: equal scores share a rank */
const ranked = <T>(rows: T[], score: (r: T) => number) => rows.map((r) => 1 + rows.filter((o) => score(o) > score(r) + 1e-9).length);

export function championship(data: Dataset, asOf: string): Result<ChampionshipValue> {
  const { label } = resolveAsOf(asOf);
  const basis = [
    "Points are the recorded points in competition results up to the selected date.",
    "Position rule: 1st 100%, 2nd 60%, 3rd 40%, 4th 20%, 5th 10% of the event's points. Tied teams split the places they occupy equally.",
    "Contingent Trophy: distinct external attendees (admitted and verified) who registered through the college's contingent.",
  ];
  const empty = { asOf: label, available: false, standings: [], trophy: null, resultsCount: 0, pointsAwarded: 0, mismatches: [] };
  if (!data.bets) return { value: empty, basis, caveats: ["The original 2025 data has no competition results or contingents."] };

  const b = betsAsOf(data.bets, asOf);
  const s = snapshot(data, asOf);
  const events = new Map(b.program_events.map((e) => [text(e.event_id), e]));
  const names = new Map(b.colleges.map((c) => [text(c.college_id), text(c.college_name)]));
  const nameOf = (id: string) => names.get(id) || id;

  const table = new Map<string, Omit<CollegeStanding, "rank">>();
  const at = (id: string) => {
    let row = table.get(id);
    if (!row) table.set(id, (row = { college_id: id, name: nameOf(id), points: 0, firsts: 0, results: [], registered: 0, verified: s.phase === "pre-event" ? null : 0, tier: 0 }));
    return row;
  };

  const tied = new Map<string, number>();
  const spot = (r: Record<string, unknown>) => `${text(r.event_id)}|${numberOf(r.position)}`;
  for (const r of b.competition_results) tied.set(spot(r), (tied.get(spot(r)) ?? 0) + 1);
  const mismatches: string[] = [];
  for (const r of b.competition_results) {
    const id = text(r.college_id);
    if (!id) continue;
    const event = events.get(text(r.event_id));
    const eventName = text(event?.event_name) || text(r.event_id);
    const position = numberOf(r.position);
    const points = numberOf(r.points);
    const row = at(id);
    row.points += points;
    if (position === 1) row.firsts++;
    row.results.push({ event_id: text(r.event_id), event: eventName, team: text(r.team_name), position, points });
    if (!event || !isSet(event.points)) mismatches.push(`${eventName}: result ${text(r.result_id)} is for a session that carries no points.`);
    else {
      const expected = tiePoints(numberOf(event.points), position, tied.get(spot(r))!);
      if (Math.abs(expected - points) > 0.05) mismatches.push(`${eventName}, position ${position}, ${nameOf(id)}: ${points} points recorded, the rules give ${Math.round(expected * 100) / 100}.`);
    }
  }

  const collegeOf = new Map(b.contingents.map((k) => [text(k.contingent_id), text(k.college_id)]));
  for (const [person, reg] of s.personReg) {
    const college = word(reg.route) === "contingent" ? collegeOf.get(text(reg.contingent_id)) : undefined;
    if (!college) continue;
    const row = at(college);
    row.registered++;
    if (row.verified != null && s.attendees.has(person)) row.verified++;
  }
  for (const t of b.contingent_tier_events) {
    const college = collegeOf.get(text(t.contingent_id));
    if (college) at(college).tier = Math.max(at(college).tier, numberOf(t.milestone));
  }

  const rows = [...table.values()].map((r) => ({ ...r, points: Math.round(r.points * 100) / 100 }));
  rows.sort((a, c) => c.points - a.points || c.firsts - a.firsts || a.name.localeCompare(c.name));
  const ranks = ranked(rows, (r) => r.points);
  const standings = rows.map((r, i) => ({ ...r, rank: ranks[i] }));
  const best = Math.max(0, ...standings.map((r) => r.verified ?? 0));
  const trophy = best > 0 ? { verified: best, colleges: standings.filter((r) => r.verified === best).map((r) => ({ college_id: r.college_id, name: r.name })) } : null;

  const caveats: string[] = [];
  if (s.phase !== "post-event") caveats.push("The fest has not finished at this date, so the standings and the trophy can still change.");
  if (mismatches.length) caveats.push(`${mismatches.length} recorded result(s) do not follow the points rules. The standings use the recorded points.`);
  return {
    value: { asOf: label, available: true, standings, trophy, resultsCount: b.competition_results.length, pointsAwarded: Math.round(rows.reduce((a, r) => a + r.points, 0) * 100) / 100, mismatches },
    basis,
    caveats,
  };
}
