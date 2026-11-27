// Unusual days, found the same way for any data: a day is compared with the campaign's own recent days.
// Nothing here knows the story behind the data, so it also reacts when someone edits a record.
import { snapshot, type Snapshot } from "./metrics";
import { addDays, daysBetween, istDay } from "./time";
import type { Dataset } from "./types";

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** median absolute deviation */
export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** robust z-score; the MAD is floored at 1 so a flat baseline does not make every bump look extreme */
export const robustZ = (x: number, xs: number[]) => (x - median(xs)) / (1.4826 * Math.max(1, mad(xs)));

export const SPIKE_RULE = { window: 14, minActiveDays: 5, minCount: 15, multiple: 3, minZ: 4 };
export const FLAT_RULE = { minBaselineMedian: 5, minZeroDays: 3 };
export const SPEND_RULE = { minRows: 5, multiple: 4, minExcessInr: 5000 };

export interface Episode {
  campaign_id: string;
  campaign_name: string;
  from: string;
  to: string;
  days: number;
  count: number;
  usual: number;
  excess: number;
  peak: { day: string; count: number };
  /** registrations in the spike, once 7 days have passed since it ended */
  followUp: null | { cohort: number; cohortConfirmedPct: number; restConfirmedPct: number; cohortCancelledPct: number; restCancelledPct: number; rest: number };
}

export interface Flatline {
  campaign_id: string;
  campaign_name: string;
  zeroSince: string;
  zeroDays: number;
  usual: number;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** new registered external people per campaign per IST day, up to the as-of day */
function registrationsByDay(s: Snapshot) {
  const by = new Map<string, Map<string, string[]>>();
  for (const [pid, r] of s.personReg) {
    if (!r.campaign_id) continue;
    const d = istDay(r.ms);
    let m = by.get(r.campaign_id);
    if (!m) by.set(r.campaign_id, (m = new Map()));
    const list = m.get(d);
    if (list) list.push(pid);
    else m.set(d, [pid]);
  }
  return by;
}

export function registrationAnomalies(data: Dataset, asOf: string): { episodes: Episode[]; flatlines: Flatline[] } {
  const s = snapshot(data, asOf);
  const p = s.p;
  const by = registrationsByDay(s);
  const plan = new Map((data.campaign_plan ?? []).map((c) => [c.campaign_id, c]));
  const lastDay = s.day < p.event.startDay ? s.day : addDays(p.event.startDay, -1);
  const episodes: Episode[] = [];
  const flatlines: Flatline[] = [];
  const { confirmed } = statusSets(s);

  for (const [cid, perDay] of by) {
    const name = p.campaignById.get(cid)?.campaign_name ?? cid;
    const dayList = [...perDay.keys()].sort();
    if (!dayList.length) continue;
    const firstDay = dayList[0];
    const count = (d: string) => perDay.get(d)?.length ?? 0;
    let open: Episode | null = null;
    let openPeople: string[] = [];
    const close = () => {
      if (!open) return;
      const ended = daysBetween(open.to, s.day) >= 7;
      if (ended) {
        const cohortSet = new Set(openPeople);
        const cutoff = addDays(s.day, -7);
        const rest = [...s.personReg].filter(([pid, r]) => r.campaign_id === cid && !cohortSet.has(pid) && istDay(r.ms) <= cutoff).map(([pid]) => pid);
        const cancelled = (ids: string[]) => ids.filter((pid) => s.statusOf(s.personReg.get(pid)!.registration_id, s.asOfMs)?.status === "cancelled").length;
        open.followUp = {
          cohort: openPeople.length,
          rest: rest.length,
          cohortConfirmedPct: pct(openPeople.filter((x) => confirmed.has(x)).length, openPeople.length),
          restConfirmedPct: pct(rest.filter((x) => confirmed.has(x)).length, rest.length),
          cohortCancelledPct: pct(cancelled(openPeople), openPeople.length),
          restCancelledPct: pct(cancelled(rest), rest.length),
        };
      }
      episodes.push(open);
      open = null;
      openPeople = [];
    };
    for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
      const c = count(d);
      const base: number[] = [];
      for (let k = SPIKE_RULE.window; k >= 1; k--) {
        const b = addDays(d, -k);
        if (b >= firstDay) base.push(count(b));
      }
      const active = base.filter((x) => x > 0).length;
      const m = median(base);
      const spike = active >= SPIKE_RULE.minActiveDays && c >= Math.max(SPIKE_RULE.minCount, SPIKE_RULE.multiple * m) && robustZ(c, base) >= SPIKE_RULE.minZ;
      if (spike) {
        if (!open) open = { campaign_id: cid, campaign_name: name, from: d, to: d, days: 0, count: 0, usual: m, excess: 0, peak: { day: d, count: 0 }, followUp: null };
        open.to = d;
        open.days++;
        open.count += c;
        open.excess += Math.max(0, c - open.usual);
        if (c > open.peak.count) open.peak = { day: d, count: c };
        openPeople.push(...(perDay.get(d) ?? []));
      } else close();
    }
    close();

    // flatline: an active campaign that was bringing people in has gone quiet up to the as-of day
    const st = plan.get(cid)?.app_status;
    const end = p.campaignById.get(cid)?.planned_end_at;
    if (st === "paused" || st === "stopped" || (end && end.slice(0, 10) < s.day) || s.day >= p.event.startDay) continue;
    let zeros = 0;
    for (let d = s.day; d >= firstDay && count(d) === 0; d = addDays(d, -1)) zeros++;
    if (zeros >= FLAT_RULE.minZeroDays) {
      const since = addDays(s.day, -(zeros - 1));
      const base: number[] = [];
      for (let k = SPIKE_RULE.window; k >= 1; k--) {
        const b = addDays(since, -k);
        if (b >= firstDay) base.push(count(b));
      }
      const usual = median(base);
      if (base.length >= 7 && usual >= FLAT_RULE.minBaselineMedian) flatlines.push({ campaign_id: cid, campaign_name: name, zeroSince: since, zeroDays: zeros, usual });
    }
  }
  return { episodes, flatlines };
}

function statusSets(s: Snapshot) {
  const confirmed = new Set<string>();
  for (const [pid, r] of s.personReg) if (s.statusOf(r.registration_id, s.asOfMs)?.status === "confirmed" || s.attendees.has(pid)) confirmed.add(pid);
  return { confirmed };
}

export interface SpendOutlier {
  activity_id: string;
  campaign_id: string;
  campaign_name: string;
  day: string;
  spend: number;
  usual: number;
  multiple: number;
}

/** single campaign-day spend rows far above that campaign's usual day */
export function spendOutliers(data: Dataset, asOf: string): SpendOutlier[] {
  const s = snapshot(data, asOf);
  const p = s.p;
  const rows = new Map<string, typeof p.daily>();
  for (const d of p.daily) {
    if (d.ms > s.asOfMs) continue;
    const list = rows.get(d.campaign_id);
    if (list) list.push(d);
    else rows.set(d.campaign_id, [d]);
  }
  const out: SpendOutlier[] = [];
  for (const [cid, list] of rows) {
    const spends = list.map((d) => Number(d.marketing_spend_inr ?? 0)).filter((x) => x > 0);
    if (spends.length < SPEND_RULE.minRows) continue;
    for (const d of list) {
      const x = Number(d.marketing_spend_inr ?? 0);
      const others = list.filter((o) => o !== d).map((o) => Number(o.marketing_spend_inr ?? 0)).filter((v) => v > 0);
      const usual = median(others);
      if (usual > 0 && x >= SPEND_RULE.multiple * usual && x - usual >= SPEND_RULE.minExcessInr)
        out.push({ activity_id: d.activity_id, campaign_id: cid, campaign_name: p.campaignById.get(cid)?.campaign_name ?? cid, day: d.activity_date, spend: x, usual: Math.round(usual), multiple: Math.round((x / usual) * 10) / 10 });
    }
  }
  return out.sort((a, b) => b.multiple - a.multiple);
}
