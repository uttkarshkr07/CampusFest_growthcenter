import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as E from "@/lib/engine";
import { storyDates } from "@/lib/story";
import { loadSeed } from "./seed";

const DAY = "2025-04-20";
const attendees = (d: E.Dataset, day = DAY) => E.funnel(d, day).value.actualAttendees;
const sponsorSeed = () => JSON.parse(readFileSync("data/seed/sponsor.json", "utf8")) as E.SponsorData;
const find = (issues: E.Issue[], table: string, code: string) => issues.find((i) => i.table === table && i.code === code);
/** an external person who attended on one admitted scan only, so changing that scan changes the count */
function oneScanAttendee(d: E.Dataset) {
  const external = new Set(d.people.filter((p) => p.person_type === "external").map((p) => p.person_id));
  const byPerson = new Map<string, E.CheckinRow[]>();
  for (const c of d.checkins) byPerson.set(c.person_id, [...(byPerson.get(c.person_id) ?? []), c]);
  return [...byPerson].find(([id, list]) => external.has(id) && list.length === 1 && list[0].result === "admitted" && list[0].verification === "verified")![1][0];
}

describe("story dates come from the data", () => {
  it("match today's data", () => {
    expect(storyDates(loadSeed())).toEqual({ min: "2025-01-15", max: "2025-04-20", today: "2025-03-15", day1: "2025-04-12", post: "2025-04-20" });
  });
  it("follow a new timeline, and a chosen today", () => {
    const d = loadSeed();
    d.event = [{ ...d.event[0], history_start: "2025-06-01", history_end: "2025-09-30", event_starts_at: "2025-09-12T09:00:00+05:30", event_ends_at: "2025-09-14T22:00:00+05:30" }];
    d.targets = [{ ...d.targets[0], effective_at: "2025-06-01T09:00:00+05:30" }, { ...d.targets[1], effective_at: "2025-08-01T09:00:00+05:30" }];
    expect(storyDates(d)).toEqual({ min: "2025-06-01", max: "2025-09-30", today: "2025-08-01", day1: "2025-09-12", post: "2025-09-30" });
    d.settings = [{ key: "story_today", value: "2025-07-15" }];
    expect(storyDates(d).today).toBe("2025-07-15");
  });
});

describe("agreed rules for messy records", () => {
  it("today's data has none of the problems that leave records out", () => {
    const issues = E.dataQuality(loadSeed(), sponsorSeed());
    expect(issues.filter((i) => i.effect === "excluded" || i.effect === "read_as")).toEqual([]);
  });

  it.each([
    ["no time", ""],
    ["unreadable time", "TBD"],
    ["a week before the event", "2025-04-05T10:00:00+05:30"],
    ["one minute before the gates open", "2025-04-12T09:59:00+05:30"],
    ["after the event ends", "2025-04-13T20:01:00+05:30"],
  ])("does not count an admission with %s, and lists it", (_, at) => {
    const d = loadSeed();
    const scan = oneScanAttendee(d);
    scan.occurred_at = at;
    expect(attendees(d)).toBe(2049);
    const listed = E.dataQuality(d).filter((i) => i.effect === "excluded").flatMap((i) => i.records.map((r) => r.id));
    expect(listed).toContain(scan.event_id);
  });

  it("never lets an untimed record show up at an earlier date", () => {
    const d = loadSeed();
    d.checkins.push({ ...oneScanAttendee(d), _row_id: 999999, event_id: "Z-UNTIMED", occurred_at: "" });
    expect(JSON.stringify(E.query(d, { asOf: "2025-03-15", dataset: "scans", groupBy: ["day"] }).value!.groups)).toBe("[]");
  });

  it("reads capital letters and spaces as the same word, reports them, and leaves the source alone", () => {
    const d = loadSeed();
    const scan = oneScanAttendee(d);
    scan.result = "  ADMITTED";
    scan.verification = "Verified ";
    const person = d.people.find((p) => p.person_id === scan.person_id)!;
    person.person_type = "External";
    expect(attendees(d)).toBe(2050);
    expect(E.funnel(d, DAY).value.stages[0].count).toBe(3625);
    expect(find(E.dataQuality(d), "checkins", "read_as")!.records.length).toBe(2);
    expect(find(E.dataQuality(d), "people", "read_as")!.records[0].id).toBe(person.person_id);
    expect([scan.result, person.person_type]).toEqual(["  ADMITTED", "External"]);
  });

  it("never guesses an unknown word or a missing link", () => {
    const d = loadSeed();
    const scan = oneScanAttendee(d);
    scan.result = "entered";
    d.registrations[0] = { ...d.registrations[0], campaign_id: "C99" };
    d.daily_marketing.push({ ...d.daily_marketing[0], _row_id: 999999, activity_id: "Z-SPEND", campaign_id: "C98", marketing_spend_inr: -900000 });
    expect(attendees(d)).toBe(2049);
    const issues = E.dataQuality(d);
    expect(find(issues, "checkins", "unknown_value")!.records[0].detail).toMatch(/"entered" is not one of/);
    expect(find(issues, "registrations", "unknown_campaign_id")!.records[0].detail).toContain("C99");
    expect(find(issues, "daily_marketing", "unknown_campaign_id")!.records[0].id).toBe("Z-SPEND");
    expect(find(issues, "daily_marketing", "negative_total")!.records[0].id).toBe("C98");
  });

  it("applies the same rules to sponsor records", () => {
    const s = sponsorSeed();
    const base = E.sponsorOverview(s, DAY).value;
    const latest = [...s.opportunity_history].sort((a, b) => a.effective_at.localeCompare(b.effective_at)).filter((v) => v.stage === "partner_confirmed").at(-1)!;
    latest.stage = "Partner_Confirmed ";
    expect(E.sponsorOverview(structuredClone(s), DAY).value.targets[1].actual).toBe(base.targets[1].actual);
    expect(find(E.dataQuality(loadSeed(), s), "sponsor_opportunity_history", "read_as")!.records.length).toBeGreaterThan(0);
  });

  it("gives the copilot a short list of problems", () => {
    const d = loadSeed();
    oneScanAttendee(d).occurred_at = "2025-04-05T10:00:00+05:30";
    const health = E.dataHealth(d, DAY).value;
    expect(health.problems.some((p) => p.issue === "Admission scanned outside event hours" && p.records === 1)).toBe(true);
    expect(JSON.stringify(health.problems).length).toBeLessThan(6000);
  });
});
