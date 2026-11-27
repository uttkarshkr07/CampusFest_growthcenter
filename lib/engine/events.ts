// The Event List: every program session, grouped into events by genre, with the adapted rules where the
// rulebook has a page that fits, and each session's seats as of the date.
import rulebook from "../data/events.json";
import { HACKATHON_NOTE, PROGRAM_NOTE, programView, type SessionView } from "./program";
import type { Dataset, Result } from "./types";

export const GENRE_ORDER = ["Dance", "Dramatics", "Music", "Humour", "Literary", "Quiz", "Fine Arts", "Film and Photography", "Fashion", "Gaming", "Tech", "Shows and Pronites", "Guest lectures", "Workshops"] as const;

interface RuleEntry {
  id: string;
  name: string;
  rulebookName: string | null;
  genre: string;
  sessions: string[];
  page?: number;
  about?: string;
  teamLimit?: string | null;
  timeLimit?: string | null;
  rules?: string[];
  judging?: string[];
  submission?: { what: string; deadline: string; how: string } | null;
  adapted?: string[];
  noRulesReason?: string;
  simulated?: boolean;
}

export interface EventSession extends SessionView {
  venueName: string;
}

export interface FestEvent {
  id: string;
  name: string;
  genre: string;
  rulebookName: string | null;
  cup: string | null;
  points: number | null;
  scored: boolean;
  sessions: EventSession[];
  /** null = no rulebook page fits this event */
  rules: null | {
    page: number;
    about: string;
    teamLimit: string | null;
    timeLimit: string | null;
    rules: string[];
    judging: string[];
    submission: { what: string; deadline: string; how: string } | null;
    adapted: string[];
  };
  noRulesReason: string | null;
  note: string | null;
}

const book = rulebook as { source: string; general: { rules: string[]; championship: string; adapted: string[] }; events: RuleEntry[] };
export const RULEBOOK = { source: book.source, general: book.general };

const AUTO_GENRE: Record<string, string> = { show: "Shows and Pronites", pronite: "Shows and Pronites", guest_lecture: "Guest lectures", workshop: "Workshops" };

export function eventList(data: Dataset, asOf: string): Result<{ asOf: string; hasBookings: boolean; genres: { genre: string; events: FestEvent[] }[]; events: FestEvent[] }> {
  const pv = programView(data, asOf);
  const sessions = new Map<string, EventSession>();
  for (const v of pv.value.venues) for (const s of v.sessions) sessions.set(s.event_id, { ...s, venueName: v.name });
  const program = data.bets?.program_events ?? data.program?.program_events ?? [];
  const meta = new Map(program.map((e) => [String(e.event_id), e]));
  const used = new Set<string>();
  const events: FestEvent[] = [];

  for (const r of book.events) {
    const own = r.sessions.map((id) => sessions.get(id)).filter((s): s is EventSession => !!s);
    if (!own.length) continue;
    r.sessions.forEach((id) => used.add(id));
    const rows = r.sessions.map((id) => meta.get(id)).filter(Boolean);
    const cup = rows.map((x) => x!.cup).find((c) => c != null && c !== "") ?? null;
    const points = rows.map((x) => Number(x!.points)).find((p) => Number.isFinite(p) && p > 0) ?? null;
    events.push({
      id: r.id,
      name: r.name,
      genre: r.genre,
      rulebookName: r.rulebookName,
      cup: cup ? String(cup) : null,
      points,
      scored: rows.some((x) => x!.scored === true || String(x!.scored).toLowerCase() === "true"),
      sessions: own,
      rules: r.page && r.rules
        ? { page: r.page, about: r.about ?? "", teamLimit: r.teamLimit ?? null, timeLimit: r.timeLimit ?? null, rules: r.rules, judging: r.judging ?? [], submission: r.submission ?? null, adapted: r.adapted ?? [] }
        : null,
      noRulesReason: r.noRulesReason ?? null,
      note: r.simulated ? HACKATHON_NOTE : null,
    });
  }
  // everything else in the program: shows, pronites, lectures, workshops (and any new session) is its own entry
  for (const [id, s] of sessions) {
    if (used.has(id)) continue;
    events.push({
      id: id.toLowerCase(),
      name: s.name,
      genre: AUTO_GENRE[s.kind] ?? "Other",
      rulebookName: null,
      cup: null,
      points: null,
      scored: false,
      sessions: [s],
      rules: null,
      noRulesReason: null,
      note: s.kind === "show" || s.kind === "pronite" || s.kind === "guest_lecture" ? PROGRAM_NOTE : null,
    });
  }
  const rank = (g: string) => {
    const i = (GENRE_ORDER as readonly string[]).indexOf(g);
    return i < 0 ? GENRE_ORDER.length : i;
  };
  events.sort((a, b) => rank(a.genre) - rank(b.genre) || (a.sessions[0]?.startsAt ?? "").localeCompare(b.sessions[0]?.startsAt ?? "") || a.name.localeCompare(b.name));
  const genres: { genre: string; events: FestEvent[] }[] = [];
  for (const e of events) {
    const g = genres.at(-1);
    if (g && g.genre === e.genre) g.events.push(e);
    else genres.push({ genre: e.genre, events: [e] });
  }
  return {
    value: { asOf: pv.value.asOf, hasBookings: pv.value.hasBookings, genres, events },
    basis: [book.source, "Sessions, venues, cups and points come from the CampusFest program; seats booked are as of the selected date.", ...pv.basis.slice(1)],
    caveats: pv.caveats,
  };
}
