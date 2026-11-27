// The fixed words the engine reads. A value that differs only in capital letters or outer spaces is
// read as the same word (and reported). Anything else is never guessed: it is reported as unknown.
export const KNOWN = {
  person_type: ["external", "internal", "staff", "test"],
  result: ["admitted", "denied", "pending"],
  verification: ["verified", "unverified"],
  source: ["scanner", "manual"],
  status: ["interested", "confirmed", "cancelled", "waitlisted"],
  qualification_status: ["unreviewed", "engaged", "qualified", "unqualified", "dormant"],
  stage: ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed", "lost", "withdrawn"],
  support_type: ["cash", "in_kind"],
  sponsor_event_type: ["outreach_sent", "delivered", "replied", "meeting_booked", "meeting_held", "opt_out", "introduction_received", "web_inbound"],
} as const;

export const tidy = <T>(v: T): T => (typeof v === "string" ? (v.trim().toLowerCase() as T) : v);

/** Rows with these fields tidied. A row that needs no change is returned as it is; the source is never edited. */
export function tidyRows<T extends object>(rows: T[], fields: (keyof T)[]): T[] {
  return rows.map((row) => {
    let copy: T | null = null;
    for (const f of fields) {
      const next = tidy(row[f]);
      if (next !== row[f]) (copy ??= { ...row })[f] = next;
    }
    return copy ?? row;
  });
}
