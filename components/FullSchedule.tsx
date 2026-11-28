"use client";

import type { FestEvent } from "@/lib/engine";
import { shortDay } from "@/lib/format";

/**
 * The whole program as a venue-by-time grid, one block per day, laid out like the "Schedule grid" sheet of the
 * program workbook: venues down the side, half-hour columns from 10:00 to 23:00. Sessions that run overnight are
 * clipped to each day and marked as continuing.
 */

const KIND: Record<string, { label: string; cls: string; dot: string }> = {
  competition_prelim: { label: "Competition prelim", cls: "bg-sky-100 border-sky-500 dark:bg-sky-500/20 dark:border-sky-400", dot: "bg-sky-500" },
  competition_final: { label: "Competition final", cls: "bg-indigo-100 border-indigo-600 dark:bg-indigo-500/25 dark:border-indigo-400", dot: "bg-indigo-600" },
  open_activity: { label: "Open activity", cls: "bg-lime-100 border-lime-600 dark:bg-lime-500/20 dark:border-lime-400", dot: "bg-lime-600" },
  show: { label: "Show", cls: "bg-rose-100 border-rose-500 dark:bg-rose-500/20 dark:border-rose-400", dot: "bg-rose-500" },
  pronite: { label: "Pronite", cls: "bg-amber-100 border-amber-500 dark:bg-amber-500/20 dark:border-amber-400", dot: "bg-amber-500" },
  guest_lecture: { label: "Guest lecture", cls: "bg-teal-100 border-teal-600 dark:bg-teal-500/20 dark:border-teal-400", dot: "bg-teal-600" },
  workshop: { label: "Workshop", cls: "bg-emerald-100 border-emerald-600 dark:bg-emerald-500/20 dark:border-emerald-400", dot: "bg-emerald-600" },
  hackathon: { label: "Hackathon", cls: "bg-orange-100 border-orange-500 dark:bg-orange-500/20 dark:border-orange-400", dot: "bg-orange-500" },
};
const OTHER = { label: "Other", cls: "bg-subtle-2 border-line-strong", dot: "bg-line-strong" };

const OPEN = 10 * 60; // 10:00
const CLOSE = 23 * 60; // 23:00
const SLOT = 30;
const SLOTS = (CLOSE - OPEN) / SLOT;
const MIN = 60_000;

const at = (day: string, minutes: number) => Date.parse(`${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+05:30`);
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

interface Block {
  key: string;
  eventId: string;
  name: string;
  kind: string;
  from: number;
  to: number;
  start: number;
  end: number;
  before: boolean;
  after: boolean;
  dim: boolean;
}

export default function FullSchedule({ events, days, isMatch, selected, onPick }: { events: FestEvent[]; days: string[]; isMatch: (e: FestEvent) => boolean; selected: string | null; onPick: (eventId: string) => void }) {
  const sessions = events.flatMap((e) => e.sessions.map((s) => ({ e, s })));
  const allDays = [...new Set(sessions.map(({ s }) => s.day))].sort();
  const kinds = [...new Set(sessions.map(({ s }) => s.kind))].sort((a, b) => Object.keys(KIND).indexOf(a) - Object.keys(KIND).indexOf(b));

  return (
    <section className="mb-4 rounded-xl border border-line bg-panel" aria-label="Full schedule">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 text-[12px]">
        <h2 className="mr-auto text-[13px] font-semibold">Full schedule</h2>
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-muted">
            <span className={`h-2.5 w-2.5 rounded-sm ${(KIND[k] ?? OTHER).dot}`} aria-hidden /> {(KIND[k] ?? OTHER).label}
          </span>
        ))}
      </header>
      <div className="space-y-5 p-4">
        {days.map((day, di) => {
          const open = at(day, OPEN);
          const close = at(day, CLOSE);
          const rows = new Map<string, { name: string; blocks: Block[] }>();
          for (const { e, s } of sessions) {
            const start = Date.parse(s.startsAt);
            const end = Date.parse(s.endsAt);
            const from = Math.max(start, open);
            const to = Math.min(end, close);
            if (from >= to) continue;
            const row = rows.get(s.venue_id) ?? { name: s.venueName, blocks: [] };
            row.blocks.push({
              key: `${s.event_id}-${day}`,
              eventId: e.id,
              name: s.name,
              kind: s.kind,
              from: Math.floor((from - open) / MIN / SLOT),
              to: Math.ceil((to - open) / MIN / SLOT),
              start,
              end,
              before: start < open,
              after: end > close,
              dim: !isMatch(e),
            });
            rows.set(s.venue_id, row);
          }
          const venues = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
          const dayNo = allDays.indexOf(day) + 1 || di + 1;
          return (
            <div key={day}>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                Day {dayNo}: {new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-line">
                <div className="grid min-w-[1180px] text-[11px]" style={{ gridTemplateColumns: `150px repeat(${SLOTS}, minmax(0, 1fr))` }}>
                  {/* time header: a label on each hour */}
                  <div className="sticky left-0 z-10 border-b border-line bg-subtle px-2 py-1 font-semibold text-muted" style={{ gridRow: 1, gridColumn: 1 }}>Venue</div>
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <div key={i} className={`border-b border-line bg-subtle py-1 pl-1 text-muted tabular ${i % 2 === 0 ? "border-l border-line" : ""}`} style={{ gridRow: 1, gridColumn: i + 2 }}>
                      {i % 2 === 0 ? `${String(10 + i / 2).padStart(2, "0")}:00` : ""}
                    </div>
                  ))}
                  {venues.map(([vid, row], ri) => (
                    <div key={vid} className="contents">
                      <div className={`sticky left-0 z-10 flex items-center bg-panel px-2 py-1 font-medium ${ri ? "border-t border-line" : ""}`} style={{ gridRow: ri + 2, gridColumn: 1 }}>
                        <span className="truncate" title={row.name}>
                          {row.name}
                        </span>
                      </div>
                      {/* half-hour guides */}
                      {Array.from({ length: SLOTS }, (_, i) => (
                        <div key={i} className={`${ri ? "border-t border-line" : ""} ${i % 2 === 0 ? "border-l border-line" : "border-l border-line/40"}`} style={{ gridRow: ri + 2, gridColumn: i + 2 }} aria-hidden />
                      ))}
                      {row.blocks.map((b) => {
                        const k = KIND[b.kind] ?? OTHER;
                        const when = `${hhmm(b.start)} to ${hhmm(b.end)}${b.before ? `, from ${shortDay(new Date(b.start + 330 * MIN).toISOString().slice(0, 10))}` : ""}${b.after ? `, ends ${shortDay(new Date(b.end + 330 * MIN).toISOString().slice(0, 10))}` : ""}`;
                        return (
                          <button
                            key={b.key}
                            onClick={() => onPick(b.eventId)}
                            title={`${b.name}\n${k.label}, ${when}`}
                            className={`relative z-[1] m-0.5 min-w-0 rounded-md border-l-4 px-1.5 py-1 text-left leading-tight text-ink transition hover:ring-2 hover:ring-brand/50 ${k.cls} ${b.dim ? "opacity-35" : ""} ${selected === b.eventId ? "ring-2 ring-brand" : ""}`}
                            style={{ gridRow: ri + 2, gridColumn: `${b.from + 2} / ${b.to + 2}` }}
                          >
                            <span className="line-clamp-2 font-medium">{b.name}</span>
                            <span className="block truncate text-[10px] text-muted">
                              {b.before ? "continues from the night before" : hhmm(b.start)}
                              {b.after ? ", continues overnight" : ` to ${hhmm(b.end)}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-muted">Click a session to open its event below. Venues with nothing on that day are left out. Sessions that do not match the search or filters are faded.</p>
      </div>
    </section>
  );
}
