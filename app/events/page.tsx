"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarClock, CalendarDays, ChevronDown, Clock, MapPin, Search, Trophy, Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { eventList, RULEBOOK, type FestEvent } from "@/lib/engine";
import { Badge, Caveats, Empty, PageHeader } from "@/components/ui";
import { QueryParams } from "@/components/deeplink";
import FullSchedule from "@/components/FullSchedule";
import { fmtDate, num, shortDay } from "@/lib/format";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

export default function EventsPage() {
  const { data, asOf } = useStore();
  const res = useMemo(() => (data ? eventList(data, asOf) : null), [data, asOf]);
  const [q, setQ] = useState("");
  const [day, setDay] = useState("");
  const [scoredOnly, setScoredOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    if (focus && res?.value.events.some((e) => e.id === focus)) setSelected(focus);
    // only a new link should move the selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, !!res]);

  if (!res) return null;
  const v = res.value;
  const days = [...new Set(v.events.flatMap((e) => e.sessions.map((s) => s.day)))].sort();
  const match = (e: FestEvent) =>
    (!q || `${e.name} ${e.rulebookName ?? ""} ${e.genre}`.toLowerCase().includes(q.toLowerCase())) && (!day || e.sessions.some((s) => s.day === day)) && (!scoredOnly || e.scored);
  const genres = v.genres.map((g) => ({ ...g, events: g.events.filter(match) })).filter((g) => g.events.length);
  const current = v.events.find((e) => e.id === selected) ?? null;

  return (
    <div>
      <QueryParams onParams={(p) => setFocus(p.get("focus"))} />
      <PageHeader title="Event list" subtitle={`${v.events.length} events in the CampusFest 2025 program, by genre. Rules are adapted from the Spring Fest 2026 rulebook; seats are as of ${fmtDate(asOf)}.`} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <label className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" className="w-44 border-0 bg-transparent p-0 text-[13px] focus:shadow-none" aria-label="Search events" />
        </label>
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Day">
          {["", ...days].map((d) => (
            <button key={d || "all"} onClick={() => setDay(d)} aria-pressed={day === d} className={`px-2.5 py-1 ${day === d ? "bg-ink font-semibold text-on-accent" : "bg-panel hover:bg-subtle"}`}>
              {d ? shortDay(d) : "Both days"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={scoredOnly} onChange={(e) => setScoredOnly(e.target.checked)} /> Championship events only
        </label>
        <button onClick={() => setShowSchedule(!showSchedule)} aria-expanded={showSchedule} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium ${showSchedule ? "border-brand bg-brand-soft text-brand" : "border-line bg-panel hover:bg-subtle"}`}>
          <CalendarDays className="h-3.5 w-3.5" /> Full schedule <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSchedule ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showSchedule && (
        <FullSchedule
          events={v.events}
          days={day ? [day] : days}
          isMatch={(e) => match(e)}
          selected={selected}
          onPick={(id) => {
            setSelected(id);
            requestAnimationFrame(() => document.getElementById("event-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <nav className="space-y-3" aria-label="Events by genre">
          {genres.length === 0 && <Empty>No event matches.</Empty>}
          {genres.map((g) => (
            <section key={g.genre} className="rounded-xl border border-line bg-panel">
              <h2 className="border-b border-line px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                {g.genre} <span className="font-normal">({g.events.length})</span>
              </h2>
              <ul className="p-1">
                {g.events.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => setSelected(e.id)} aria-pressed={selected === e.id} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${selected === e.id ? "bg-brand-soft font-semibold text-brand" : "hover:bg-subtle"}`}>
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      {e.points != null && <span className="tabular rounded bg-subtle-2 px-1.5 text-[11px] text-ink-2">{e.points} pts</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <div id="event-detail" className="scroll-mt-4 space-y-4">
          {current ? <EventDetail e={current} hasBookings={v.hasBookings} /> : <GeneralRules />}
          {current && <GeneralRules compact />}
          <Caveats items={res.caveats} basis={res.basis} />
        </div>
      </div>
    </div>
  );
}

function EventDetail({ e, hasBookings }: { e: FestEvent; hasBookings: boolean }) {
  const r = e.rules;
  return (
    <article className="rounded-xl border border-line bg-panel">
      <header className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full bg-subtle-2 px-2 py-0.5 font-semibold">{e.genre}</span>
          {e.scored && e.cup && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand">
              <Trophy className="h-3 w-3" /> {e.cup} cup{e.points != null ? `, ${e.points} points` : ""}
            </span>
          )}
          {!e.scored && e.sessions.some((s) => s.kind.startsWith("competition") || s.kind === "open_activity") && <span className="rounded-full border border-line px-2 py-0.5 text-muted">Not scored for the Championship</span>}
          {r && <span className="text-muted">Rulebook: {e.rulebookName}, p.{r.page}</span>}
        </div>
        <h2 className="mt-1.5 text-lg font-semibold">{e.name}</h2>
        {e.note && <p className="mt-1 rounded-md bg-warn-soft px-2 py-1 text-[12px] font-medium text-warn">{e.note}</p>}
        {r && <p className="mt-1 text-[13px] text-ink-2">{r.about}</p>}
      </header>

      <div className="space-y-4 p-4">
        {r && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Fact icon={Users} label="Team" value={r.teamLimit ?? "Not stated"} />
            <Fact icon={Clock} label="Time limit" value={r.timeLimit ?? "Not stated"} />
            <Fact icon={CalendarClock} label="Submission deadline" value={r.submission ? `${fmtDate(r.submission.deadline)}: ${r.submission.what}` : "Nothing to submit"} />
          </div>
        )}

        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Sessions</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {e.sessions.map((s) => {
              const b = s.booking;
              const fill = b && s.seatsOffered ? Math.round((b.booked / s.seatsOffered) * 100) : null;
              return (
                <li key={s.event_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                  <span className="w-28 font-medium">
                    {shortDay(s.day)}, {time(s.startsAt)}
                  </span>
                  <span className="min-w-0 flex-1">{s.name}</span>
                  <Link href={`/map?focus=${s.event_id}`} className="inline-flex items-center gap-1 text-brand">
                    <MapPin className="h-3.5 w-3.5" /> {s.venueName}
                  </Link>
                  <span className="tabular w-48 text-right text-[12px] text-muted">
                    {!s.bookingRequired
                      ? s.kind === "pronite"
                        ? "Entry with the pass"
                        : "No seat booking"
                      : !hasBookings || !b
                        ? `${num(s.seatsOffered)} seats, booking data not in this dataset`
                        : `${num(b.booked)} of ${num(s.seatsOffered)} booked (${fill}%)${b.waiting ? `, ${num(b.waiting)} waiting` : ""}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {r ? (
          <>
            <section>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Rules</h3>
              <ol className="list-decimal space-y-1 pl-5 text-[13px]">
                {r.rules.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ol>
            </section>
            {r.judging.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Judging criteria</h3>
                <ul className="flex flex-wrap gap-1.5 text-[12px]">
                  {r.judging.map((x) => (
                    <li key={x} className="rounded-md bg-subtle px-2 py-1">
                      {x}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {r.submission && (
              <p className="rounded-lg bg-subtle px-3 py-2 text-[13px]">
                <b>How to submit:</b> {r.submission.how} Deadline {fmtDate(r.submission.deadline)}.
              </p>
            )}
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer select-none">What changed from the rulebook ({r.adapted.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {r.adapted.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          e.noRulesReason && <p className="text-[12px] text-muted">No rules listed: {e.noRulesReason}</p>
        )}
      </div>
    </article>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-subtle px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-[13px] font-medium">{value}</div>
    </div>
  );
}

function GeneralRules({ compact }: { compact?: boolean }) {
  const g = RULEBOOK.general;
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <BookOpen className="h-4 w-4 text-brand" />
        <h2 className="text-[13px] font-semibold">General rules for all events</h2>
        <Badge kind="neutral">ADAPTED</Badge>
      </header>
      <div className="space-y-3 p-4 text-[13px]">
        {!compact && <p className="text-muted">Pick an event on the left to see its rules, sessions and seats.</p>}
        <ol className="list-decimal space-y-1 pl-5">
          {g.rules.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
        <p className="rounded-lg bg-brand-soft px-3 py-2">{g.championship}</p>
        <details className="text-[12px] text-muted">
          <summary className="cursor-pointer select-none">What changed from the rulebook</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {g.adapted.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
        <p className="text-[11px] text-muted">{RULEBOOK.source}</p>
      </div>
    </section>
  );
}
