// Who to act on: concrete groups of people behind the funnel leaks.
import { baseCaveats, DEF, externalStatusCounts, snapshot, type Snapshot } from "./metrics";
import type { Dataset, Result } from "./types";

export const COHORTS = {
  confirmed_not_engaged: {
    label: "Confirmed, no question asked",
    definition: "Registered external people whose latest status is 'confirmed' and who have not submitted an event question.",
  },
  interested_not_confirmed: {
    label: "Interested, not confirmed",
    definition: "Registered external people whose latest status is 'interested'.",
  },
  waitlisted: {
    label: "Waitlisted",
    definition: "Registered external people whose latest status is 'waitlisted'.",
  },
  gate_failed_not_admitted: {
    label: "Failed at the gate, never admitted",
    definition: "External people with a denied, pending or unverified scan and no admitted and verified scan.",
  },
} as const;

export type Cohort = keyof typeof COHORTS;
export const COHORT_KEYS = Object.keys(COHORTS) as Cohort[];

export interface CohortMember {
  person_id: string;
  person_name: string;
  campaign_id: string | null;
  status: string | null;
  note: string | null;
  attended: boolean | null;
}

function members(s: Snapshot, cohort: Cohort): CohortMember[] {
  const p = s.p;
  const post = s.phase !== "pre-event";
  const make = (pid: string, note: string | null = null): CohortMember => {
    const reg = s.personReg.get(pid);
    return {
      person_id: pid,
      person_name: p.personById.get(pid)?.person_name ?? pid,
      campaign_id: reg?.campaign_id ?? null,
      status: reg ? (s.statusOf(reg.registration_id, s.statusMs)?.status ?? null) : null,
      note,
      attended: post ? s.attendees.has(pid) : null,
    };
  };
  if (cohort === "gate_failed_not_admitted") {
    const failed = new Map<string, string>();
    for (const c of p.checkins) {
      if (c.ms > s.asOfMs || !s.isExternal(c.person_id) || s.attendees.has(c.person_id)) continue;
      if (c.result === "admitted" && c.verification === "verified") continue;
      failed.set(c.person_id, `${c.result}, ${c.verification}`);
    }
    return [...failed].map(([pid, note]) => make(pid, note));
  }
  const ordered = [...s.personReg.entries()].sort((a, b) => a[1].ms - b[1].ms);
  const out: CohortMember[] = [];
  for (const [pid, reg] of ordered) {
    const status = s.statusOf(reg.registration_id, s.statusMs)?.status;
    const hit =
      (cohort === "confirmed_not_engaged" && status === "confirmed" && !s.questionAskers.has(pid)) ||
      (cohort === "interested_not_confirmed" && status === "interested") ||
      (cohort === "waitlisted" && status === "waitlisted");
    if (hit) out.push(make(pid));
  }
  return out;
}

function cohortCaveats(s: Snapshot, cohort: Cohort): string[] {
  const c: string[] = [];
  if (cohort === "confirmed_not_engaged" && s.phase === "pre-event")
    c.push("It is NOT yet known whether people who asked no question are less likely to attend. Treating this group as at risk is an untested idea.");
  if (cohort === "gate_failed_not_admitted") {
    if (s.phase === "pre-event") c.push("There are no gate scans before the event, so this group cannot be known yet.");
    else c.push("The data does not record why a scan failed or whether anyone tried to help.");
  }
  return c;
}

/** Full list for screens and exports. The copilot gets the summary from actionList instead. */
export function actionMembers(data: Dataset, asOf: string, cohort: Cohort): CohortMember[] {
  return members(snapshot(data, asOf), cohort);
}

export function actionList(data: Dataset, asOf: string, cohort?: Cohort) {
  const s = snapshot(data, asOf);
  const keys = cohort ? [cohort] : COHORT_KEYS;
  const { counts } = externalStatusCounts(s);
  const groups = keys.map((k) => {
    const list = members(s, k);
    const by = new Map<string, number>();
    for (const m of list) by.set(m.campaign_id ?? "unattributed", (by.get(m.campaign_id ?? "unattributed") ?? 0) + 1);
    const attended = s.phase === "post-event" ? list.filter((m) => m.attended).length : null;
    return {
      cohort: k,
      label: COHORTS[k].label,
      definition: COHORTS[k].definition,
      count: list.length,
      byCampaign: [...by]
        .map(([campaign_id, count]) => ({ campaign_id, campaign_name: s.p.campaignById.get(campaign_id)?.campaign_name ?? "No campaign", count }))
        .sort((a, b) => b.count - a.count),
      examples: list.slice(0, cohort ? 5 : 0).map((m) => ({ person_id: m.person_id, person_name: m.person_name, campaign_id: m.campaign_id, note: m.note })),
      laterAttended: attended,
      laterShowUpPct: attended != null && list.length ? Math.round((attended / list.length) * 1000) / 10 : null,
    };
  });
  const caveats = [...baseCaveats(s), ...keys.flatMap((k) => cohortCaveats(s, k))];
  caveats.push("Group sizes are not recoverable attendees: nothing in the data shows how many would attend if contacted. The groups can overlap.");
  return {
    value: { asOf: s.label, phase: s.phase, statusCounts: counts, groups, fullListAvailableOn: "/actions" },
    basis: [DEF.asOf, DEF.dedup, DEF.status, DEF.attendee],
    caveats,
  } satisfies Result<unknown>;
}
