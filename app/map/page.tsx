"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { HACKATHON_NOTE, PROGRAM_NOTE, programView, type SessionView, type VenueView } from "@/lib/engine";
import CampusMap, { FILL_STEPS, fillStep } from "@/components/CampusMap";
import { QueryParams, useSpotlight } from "@/components/deeplink";
import { Card, Caveats, Empty, PageHeader } from "@/components/ui";
import { fmtDate, num } from "@/lib/format";

const dayName = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

export default function MapPage() {
  const { data, asOf } = useStore();
  const res = useMemo(() => (data ? programView(data, asOf) : null), [data, asOf]);
  const [pickedDay, setDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  useSpotlight(spot);

  // a link may name a venue or a session; a session opens its venue on its day
  useEffect(() => {
    if (!focus || !res) return;
    const venue = res.value.venues.find((v) => v.venue_id === focus);
    if (venue) {
      setSelected(venue.venue_id);
      setSpot("venue-panel");
      return;
    }
    const session = res.value.venues.flatMap((v) => v.sessions).find((s) => s.event_id === focus);
    if (session) {
      setSelected(session.venue_id);
      setDay(session.day);
      setSpot(`session-${session.event_id}`);
    }
    // only a new link should move the selection, not a new selected date
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, !!res]);

  if (!data || !res) return null;
  const { venues, days, hasBookings } = res.value;
  const day = pickedDay && days.includes(pickedDay) ? pickedDay : days.includes(asOf) ? asOf : (days[0] ?? "");
  const venue = venues.find((v) => v.venue_id === selected) ?? null;
  const missing = !!focus && !venues.some((v) => v.venue_id === focus || v.sessions.some((s) => s.event_id === focus));

  return (
    <div className="space-y-4">
      <QueryParams onParams={(p) => setFocus(p.get("focus"))} />
      <PageHeader
        title="Campus map"
        subtitle={hasBookings ? `Venues, sessions and seats as of the end of ${fmtDate(asOf)}. Click a venue.` : "The festival program by venue. Click a venue."}
        right={
          <div className="flex gap-1" role="group" aria-label="Fest day">
            {days.map((d) => (
              <button key={d} onClick={() => setDay(d)} aria-pressed={d === day} className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium ${d === day ? "bg-brand text-white" : "border border-line bg-white hover:bg-slate-50"}`}>
                {dayName(d)}
              </button>
            ))}
          </div>
        }
      />
      <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">{PROGRAM_NOTE}</p>
      {missing && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">{focus} is not a venue or session in this program.</p>}
      {!hasBookings && <p className="rounded-md border border-line bg-white px-3 py-2 text-[13px]">Booking data does not exist in the original 2025 data: no seats booked, waitlists, offers or door scans. Switch to the simulated run to see them.</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div className="space-y-3">
          <Card>
            <CampusMap venues={venues} day={day} selected={selected} colour={hasBookings} onSelect={setSelected} />
            {hasBookings && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <span className="font-medium">Seats booked on {dayName(day)}:</span>
                {FILL_STEPS.map((s) => (
                  <span key={s.min} className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm border border-slate-400" style={{ background: s.box }} /> {s.label}
                  </span>
                ))}
                <span className="text-muted">Dark label: nothing to book that day.</span>
              </div>
            )}
            <Caveats items={res.caveats} basis={res.basis} />
          </Card>
          <Card title="All venues">
            <div className="flex flex-wrap gap-1.5">
              {venues.map((v) => {
                const fill = hasBookings ? v.fillByDay[day] : undefined;
                return (
                  <button key={v.venue_id} onClick={() => setSelected(v.venue_id)} aria-pressed={selected === v.venue_id} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] ${selected === v.venue_id ? "border-brand bg-brand-soft font-semibold" : "border-line hover:bg-slate-50"}`}>
                    {fill && <span className="h-2.5 w-2.5 rounded-sm border border-slate-400" style={{ background: fillStep(fill.fill).box }} />}
                    {v.name}
                    <span className="text-muted">{v.sessions.filter((s) => s.day === day).length || "no"} session(s)</span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
        <div id="venue-panel" className="self-start rounded-lg">
          {venue ? <VenuePanel venue={venue} day={day} hasBookings={hasBookings} /> : <Empty>Choose a venue on the map or in the list.</Empty>}
        </div>
      </div>
    </div>
  );
}

function VenuePanel({ venue, day, hasBookings }: { venue: VenueView; day: string; hasBookings: boolean }) {
  const fill = venue.fillByDay[day];
  const days = [...new Set(venue.sessions.map((s) => s.day))];
  // the day chosen above comes first
  days.sort((a, b) => Number(b === day) - Number(a === day) || a.localeCompare(b));
  return (
    <Card title={venue.name}>
      <div className="text-[13px]">
        <span className="capitalize">{venue.type}</span> · {venue.capacity == null ? "no capacity limit recorded" : `capacity ${num(venue.capacity)}`} · {venue.seated ? "seated" : "open, not seated"}
      </div>
      {venue.notes && <div className="mt-1 text-[12px] text-muted">{venue.notes}</div>}
      {hasBookings && fill && (
        <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[12px]">
          {dayName(day)}: {num(fill.booked)} of {num(fill.seats)} bookable seats booked ({fill.fill}%).
        </div>
      )}
      {!venue.sessions.length && <div className="mt-3"><Empty>No sessions are scheduled at this venue.</Empty></div>}
      {days.map((d) => (
        <section key={d} className="mt-3">
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{dayName(d)}</h3>
          <ul className="space-y-2">
            {venue.sessions
              .filter((s) => s.day === d)
              .map((s) => (
                <Session key={s.event_id} s={s} hasBookings={hasBookings} />
              ))}
          </ul>
        </section>
      ))}
    </Card>
  );
}

function Session({ s, hasBookings }: { s: SessionView; hasBookings: boolean }) {
  const b = s.booking;
  return (
    <li id={`session-${s.event_id}`} className="rounded-md border border-line p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-medium">
          {s.name}
          {s.brand && <span className="text-muted"> ({s.brand})</span>}
        </div>
        <div className="tabular whitespace-nowrap text-[12px] text-muted">
          {clock(s.startsAt)} to {clock(s.endsAt)}
        </div>
      </div>
      <div className="text-[11px] text-muted">
        <span className="capitalize">{s.kind.replace(/_/g, " ")}</span> · {s.event_id} · {s.bookingRequired ? `seat booking, ${num(s.seatsOffered)} seats offered` : "no seat booking"}
      </div>
      {/hackathon/i.test(`${s.name} ${s.kind}`) && <div className="mt-1 text-[11px] font-semibold text-warn">{HACKATHON_NOTE}</div>}
      {hasBookings && b && (
        <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[12px]">
          <Stat label="Booked" value={`${num(b.booked)} of ${num(s.seatsOffered)}`} />
          <Stat label="Waitlist" value={num(b.waiting)} />
          <Stat label="Attended" value={b.attended == null ? "not started" : num(b.attended)} />
          <Stat label="Offers claimed" value={num(b.offersClaimed)} />
          <Stat label="Offers expired" value={num(b.offersExpired)} />
          {b.turnaways != null ? <Stat label="Turned away (full)" value={num(b.turnaways)} /> : <Stat label="Offers open" value={num(b.offersOpen)} />}
        </dl>
      )}
    </li>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-[11px] text-muted">{label}</dt>
    <dd className="tabular font-medium">{value}</dd>
  </div>
);
