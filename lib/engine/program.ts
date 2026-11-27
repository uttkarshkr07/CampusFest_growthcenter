// The campus map: each venue, its sessions by day, and what had been booked by the selected date.
import { betsAsOf, isSet, numberOf, text, timeBy, word } from "./betview";
import type { BetRow, Dataset, Program, Result } from "./types";
import { istDay, resolveAsOf, toMs } from "./time";

export const PROGRAM_NOTE = "Illustrative lineup in a simulated program. No artist, speaker or company named here is booked, sponsoring or affiliated.";
export const HACKATHON_NOTE = "SIMULATED SCENARIO: RISA Labs has not agreed to this.";

export interface SessionBooking {
  booked: number;
  waiting: number;
  offersClaimed: number;
  offersExpired: number;
  offersOpen: number;
  /** null until the session starts */
  attended: number | null;
  turnaways: number | null;
}

export interface SessionView {
  event_id: string;
  name: string;
  brand: string | null;
  kind: string;
  day: string;
  startsAt: string;
  endsAt: string;
  venue_id: string;
  bookingRequired: boolean;
  seatsOffered: number | null;
  sponsor: string | null;
  notes: string | null;
  /** null when no booking data exists for it */
  booking: SessionBooking | null;
}

export interface DayFill {
  seats: number;
  booked: number;
  /** booked / seats as a percentage */
  fill: number;
}

export interface VenueView {
  venue_id: string;
  name: string;
  type: string;
  capacity: number | null;
  seated: boolean;
  notes: string | null;
  sessions: SessionView[];
  /** by day, over the sessions that take bookings; absent when there are none */
  fillByDay: Record<string, DayFill>;
}

export interface ProgramValue {
  asOf: string;
  hasBookings: boolean;
  days: string[];
  venues: VenueView[];
}

export const programOf = (data: Dataset): Program | undefined => data.bets ?? data.program;

export const isBookable = (e: BetRow) => (e.booking_required === true || word(e.booking_required) === "yes") && numberOf(e.seats_offered) > 0;

const group = (rows: BetRow[], column: string) => {
  const m = new Map<string, BetRow[]>();
  for (const r of rows) {
    const k = text(r[column]);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

/** each booking's latest history row at or before the date (histories are full state) */
export function latestBookings(history: BetRow[]): BetRow[] {
  const latest = new Map<string, BetRow>();
  const order = (r: BetRow) => [toMs(text(r.effective_at)), text(r.history_id)] as const;
  for (const row of history) {
    const prev = latest.get(text(row.booking_id));
    if (prev) {
      const [a, ai] = order(row);
      const [b, bi] = order(prev);
      if (a < b || (a === b && ai.localeCompare(bi) < 0)) continue;
    }
    latest.set(text(row.booking_id), row);
  }
  return [...latest.values()];
}

/** booking figures for every session, from tables already cut to the selected date */
export function sessionBookings(bets: ReturnType<typeof betsAsOf>, ms: number): Map<string, SessionBooking> {
  const bookings = group(latestBookings(bets.seat_booking_history), "event_id");
  const waiting = group(bets.waitlist_entries.filter((w) => word(w.kind) === "show_seat" && !isSet(w.left_at)), "event_id");
  const offers = group(bets.exchange_offers.filter((o) => word(o.kind) === "show_seat"), "event_id");
  const scans = group(bets.seat_scans, "event_id");
  const out = new Map<string, SessionBooking>();
  for (const e of bets.program_events) {
    if (!isBookable(e)) continue;
    const id = text(e.event_id);
    const started = timeBy(e.starts_at, ms);
    const mine = scans.get(id) ?? [];
    const people = (rows: BetRow[]) => new Set(rows.map((r) => text(r.person_id))).size;
    const own = offers.get(id) ?? [];
    out.set(id, {
      booked: (bookings.get(id) ?? []).filter((b) => word(b.status) === "booked").length,
      waiting: (waiting.get(id) ?? []).length,
      offersClaimed: own.filter((o) => isSet(o.claimed_at)).length,
      offersExpired: own.filter((o) => !isSet(o.claimed_at) && isSet(o.expired_at)).length,
      offersOpen: own.filter((o) => !isSet(o.claimed_at) && !isSet(o.expired_at)).length,
      attended: started ? people(mine.filter((s) => word(s.result) === "admitted")) : null,
      turnaways: started ? people(mine.filter((s) => word(s.result) === "denied" && word(s.deny_reason) === "full")) : null,
    });
  }
  return out;
}

export function programView(data: Dataset, asOf: string): Result<ProgramValue> {
  const { ms, day, label } = resolveAsOf(asOf);
  const bets = data.bets && betsAsOf(data.bets, asOf);
  const program = bets ?? data.program;
  const booking = bets ? sessionBookings(bets, ms) : null;
  const sessions: SessionView[] = (program?.program_events ?? [])
    .filter((e) => !e._deleted)
    .map((e) => ({
      event_id: text(e.event_id),
      name: text(e.event_name),
      brand: text(e.brand_name) || null,
      kind: text(e.kind),
      day: istDay(toMs(text(e.starts_at))),
      startsAt: text(e.starts_at),
      endsAt: text(e.ends_at),
      venue_id: text(e.venue_id),
      bookingRequired: isBookable(e),
      seatsOffered: isSet(e.seats_offered) ? numberOf(e.seats_offered) : null,
      sponsor: text(e.sponsor) || null,
      notes: text(e.notes) || null,
      booking: booking?.get(text(e.event_id)) ?? null,
    }))
    .sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt) || a.event_id.localeCompare(b.event_id));
  const byVenue = new Map<string, SessionView[]>();
  for (const s of sessions) byVenue.set(s.venue_id, [...(byVenue.get(s.venue_id) ?? []), s]);

  const venues: VenueView[] = (program?.venues ?? [])
    .filter((v) => !v._deleted)
    .map((v) => {
      const own = byVenue.get(text(v.venue_id)) ?? [];
      const fillByDay: Record<string, DayFill> = {};
      for (const s of own) {
        if (!s.booking || !s.seatsOffered) continue;
        const f = (fillByDay[s.day] ??= { seats: 0, booked: 0, fill: 0 });
        f.seats += s.seatsOffered;
        f.booked += s.booking.booked;
        f.fill = Math.round((f.booked / f.seats) * 1000) / 10;
      }
      return {
        venue_id: text(v.venue_id),
        name: text(v.venue_name),
        type: text(v.venue_type).replace(/_/g, " "),
        capacity: isSet(v.capacity) ? numberOf(v.capacity) : null,
        seated: v.seated === true || word(v.seated) === "yes",
        notes: text(v.notes) || null,
        sessions: own,
        fillByDay,
      };
    });

  const caveats = [PROGRAM_NOTE];
  if (!bets) caveats.push("The original 2025 data has no seat bookings, waitlists, offers or door scans. Only the program is shown.");
  else if (day < "2025-04-03") caveats.push("In the plan, seat booking opens on 3 Apr, so little or nothing may be booked yet at this date.");
  return {
    value: { asOf: label, hasBookings: !!bets, days: [...new Set(sessions.map((s) => s.day))].sort(), venues },
    basis: [
      "The program is the plan, so it is shown at every date.",
      ...(bets
        ? [
            "Booked = bookings whose latest status at or before the selected date is 'booked'.",
            "Waiting = show-seat waitlist entries joined and not yet left. Offers are counted as claimed, expired or still open at the selected date.",
            "Attended = people admitted at the session door, shown only once the session has started. Turnaways = people denied at the door because it was full.",
            "Venue colour = booked / seats offered over that day's bookable sessions. One person can book several sessions.",
          ]
        : []),
    ],
    caveats,
  };
}
