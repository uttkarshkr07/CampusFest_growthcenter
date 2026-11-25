import { describe, expect, it } from "vitest";
import { loadSeed } from "./seed";
import * as E from "@/lib/engine";

const POST = "2025-04-20";
const EVENT_START = "2025-04-12T10:00:00+05:30";

// handoff section 4 (spend / registered / attended / show-up % / INR per actual attendee as written there)
const CAMPAIGNS: Record<string, [number, number, number, number, number]> = {
  C01: [42000, 520, 390, 75, 107],
  C02: [93000, 680, 340, 50, 273],
  C03: [59000, 350, 175, 50, 337],
  C04: [31000, 450, 385, 86, 80],
  C05: [19000, 350, 275, 79, 69],
  C06: [14000, 250, 195, 78, 71],
  C07: [16000, 200, 165, 82, 96],
};

describe("oracles as of 2025-04-20 (post-event)", () => {
  const d = loadSeed();
  const f = E.funnel(d, POST).value;
  const stage = (k: string) => f.stages.find((s) => s.key === k)!.count;

  it("3,625 identified external", () => expect(stage("identified")).toBe(3625));
  it("2,800 registered external people", () => expect(stage("registered")).toBe(2800));
  it("2,050 actual attendees = 1,925 registered + 125 walk-ins", () => {
    expect(f.actualAttendees).toBe(2050);
    expect(stage("attended")).toBe(1925);
    expect(f.walkIns).toBe(125);
  });
  it("575 confirmed registrants never showed; biggest leak is confirmed to attended", () => {
    expect(f.confirmedNoShows).toBe(575);
    expect(f.biggestLeak?.lost).toBe(575);
    expect(f.biggestLeak?.to).toMatch(/Attended/);
  });
  it("spend INR 2,74,000 and goal 2,200 at 93%", () => {
    const t = E.targetsVsActuals(d, POST).value;
    const row = (k: string) => t.rows.find((r) => r.key === k)!;
    expect(row("spend").actual).toBe(274000);
    expect(row("visitors").goal).toBe(2200);
    expect(row("visitors").actual).toBe(2050);
    expect(Math.round(row("visitors").pctOfGoal!)).toBe(93);
  });
  it("per-campaign table C01 to C07", () => {
    const rows = E.campaignTable(d, POST).value.rows;
    for (const [id, [spend, reg, att, su, inr]] of Object.entries(CAMPAIGNS)) {
      const r = rows.find((x) => x.campaign_id === id)!;
      expect(r.spend, `${id} spend`).toBe(spend);
      expect(r.registered, `${id} registered`).toBe(reg);
      expect(r.attended, `${id} attended`).toBe(att);
      expect(r.showUpPct, `${id} show-up`).toBe(Math.round((att / reg) * 1000) / 10);
      expect(Math.abs(r.showUpPct! - su), `${id} show-up vs handoff`).toBeLessThan(1);
      // engine rounds to nearest rupee; the handoff truncated. Both must agree within 1.
      expect(r.inrPerAttendee, `${id} INR/attendee`).toBe(Math.round(spend / att));
      expect(Math.abs(r.inrPerAttendee! - inr), `${id} INR/attendee vs handoff`).toBeLessThanOrEqual(1);
    }
  });
  it("3,250 verified external admissions vs 2,050 people", () => {
    const h = E.dataHealth(d, POST).value;
    expect(h.checkins.verifiedExternalAdmissions).toBe(3250);
    expect(h.checkins.distinctVerifiedExternalPeople).toBe(2050);
  });
});

describe("status at event start (2025-04-12 10:00 IST)", () => {
  const d = loadSeed();
  it("all registrations: confirmed 2,540 / cancelled 183 / waitlisted 88 / interested 29", () => {
    const c = E.registrationStatus(d, EVENT_START, { scope: "all" }).value.counts;
    expect([c.confirmed, c.cancelled, c.waitlisted, c.interested]).toEqual([2540, 183, 88, 29]);
  });
  it("external filter removes exactly the 40 internal (all confirmed)", () => {
    const all = E.registrationStatus(d, EVENT_START, { scope: "all" }).value;
    const ext = E.registrationStatus(d, EVENT_START, { scope: "external" }).value;
    expect(all.total - ext.total).toBe(40);
    expect(ext.counts.confirmed).toBe(2500);
  });
});

describe("dedup", () => {
  const h = E.dataHealth(loadSeed(), POST).value;
  const dup = (t: string) => h.duplicates.find((x) => x.table === t)!;
  it("check-ins 3,390 raw to 3,370 unique", () => expect([dup("checkins").raw, dup("checkins").unique]).toEqual([3390, 3370]));
  it("history 5,911 to 5,907", () => expect([dup("registration_history").raw, dup("registration_history").unique]).toEqual([5911, 5907]));
  it("daily 483 to 481", () => expect([dup("daily_marketing").raw, dup("daily_marketing").unique]).toEqual([483, 481]));
  it("no conflicting duplicates in the original data", () => expect(h.duplicates.every((x) => x.conflicting === 0)).toBe(true));
});

describe("as-of and target versions (no leakage)", () => {
  const d = loadSeed();
  it("14 Mar uses the launch plan; 15 Mar uses the revised plan", () => {
    expect(E.targetsVsActuals(d, "2025-03-14").value.targetVersion?.name).toBe("Attendee launch plan");
    expect(E.targetsVsActuals(d, "2025-03-15").value.targetVersion?.name).toBe("Attendee revised plan");
    expect(E.targetsVsActuals(d, "2025-03-14").value.rows.find((r) => r.key === "visitors")!.goal).toBe(1800);
  });
  it("11 Apr: zero attendees, projection mode", () => {
    const f = E.funnel(d, "2025-04-11").value;
    expect(f.actualAttendees).toBe(0);
    expect(f.phase).toBe("pre-event");
    const p = E.projection(d, "2025-04-11").value;
    expect(p.mode).toBe("projection");
    expect(p.low).toBeLessThanOrEqual(p.mid);
    expect(p.mid).toBeLessThanOrEqual(p.high);
  });
  it("earlier snapshots never count later registrations", () => {
    const early = E.funnel(d, "2025-02-01").value.stages.find((s) => s.key === "registered")!.count;
    const late = E.funnel(d, POST).value.stages.find((s) => s.key === "registered")!.count;
    expect(early).toBeLessThan(late);
    expect(E.pace(d, "2025-02-01").value.series.at(-1)!.registered).toBe(early);
  });
  it("after the event, projection reports the actual and the error", () => {
    const p = E.projection(d, POST).value;
    expect(p.mode).toBe("actual");
    expect(p.actual).toBe(2050);
    expect(p.projectionError?.madeAsOf).toBe("2025-04-11");
  });
});

describe("mutations: changed data moves the numbers", () => {
  // a person whose ONLY valid check-in is a single record
  function singleCheckinPerson(d: E.Dataset) {
    const valid = d.checkins.filter((c) => c.result === "admitted" && c.verification === "verified");
    const n = new Map<string, number>();
    for (const c of valid) n.set(c.person_id, (n.get(c.person_id) ?? 0) + 1);
    return valid.find((c) => n.get(c.person_id) === 1 && d.people.find((p) => p.person_id === c.person_id)?.person_type === "external")!;
  }

  it("changing one check-in to denied removes exactly one attendee and adds a denied scan", () => {
    const d = loadSeed();
    const target = singleCheckinPerson(d);
    const before = E.dataHealth(d, POST).value.checkins.deniedScans;
    const d2 = { ...d, checkins: d.checkins.map((c) => (c.event_id === target.event_id ? { ...c, result: "denied" } : c)) };
    expect(E.funnel(d2, POST).value.actualAttendees).toBe(2049);
    expect(E.dataHealth(d2, POST).value.checkins.deniedScans).toBe(before + 1);
  });

  it("an identical duplicate changes nothing; a conflicting duplicate keeps the last and warns", () => {
    const d = loadSeed();
    const target = singleCheckinPerson(d);
    const same = { ...d, checkins: [...d.checkins, { ...target }] };
    expect(E.funnel(same, POST).value.actualAttendees).toBe(2050);
    expect(E.dataHealth(same, POST).value.duplicates.find((x) => x.table === "checkins")!.conflicting).toBe(0);

    const conflict = { ...d, checkins: [...d.checkins, { ...target, result: "denied" }] };
    expect(E.funnel(conflict, POST).value.actualAttendees).toBe(2049);
    const h = E.dataHealth(conflict, POST).value;
    expect(h.duplicates.find((x) => x.table === "checkins")!.conflictingIds).toContain(target.event_id);
    expect(h.warnings.join(" ")).toMatch(/DIFFERENT payloads/);
  });

  it("an internal person's verified admission never counts", () => {
    const d = loadSeed();
    const internal = d.people.find((p) => p.person_type === "internal")!;
    const d2 = { ...d, checkins: [...d.checkins, { ...d.checkins[0], event_id: "CHK-TEST-1", person_id: internal.person_id, result: "admitted", verification: "verified" }] };
    expect(E.funnel(d2, POST).value.actualAttendees).toBe(2050);
  });

  it("editing spend updates INR per attendee and the flag", () => {
    const d = loadSeed();
    const row = d.daily_marketing.find((r) => r.campaign_id === "C04" && Number(r.marketing_spend_inr) > 0)!;
    const d2 = { ...d, daily_marketing: d.daily_marketing.map((r) => (r.activity_id === row.activity_id ? { ...r, marketing_spend_inr: Number(r.marketing_spend_inr) + 100000 } : r)) };
    const c = E.campaignTable(d2, POST).value.rows.find((r) => r.campaign_id === "C04")!;
    expect(c.spend).toBe(131000);
    expect(c.inrPerAttendee).toBe(Math.round(131000 / 385));
    expect(E.flags(d2, POST).value.flags.find((f) => f.campaign_id === "C04")!.level).toBe("stop");
    expect(E.flags(d, POST).value.flags.find((f) => f.campaign_id === "C04")!.level).toBe("scale");
  });

  it("a new target version applies from its effective time only", () => {
    const d = loadSeed();
    const d2 = { ...d, targets: [...d.targets, { ...d.targets[1], effective_at: "2025-04-01T09:00:00+05:30", unique_external_visitors_goal: 2600, target_version: "Test stretch" }] };
    expect(E.targetsVsActuals(d2, "2025-03-31").value.targetVersion?.name).toBe("Attendee revised plan");
    const after = E.targetsVsActuals(d2, POST).value;
    expect(after.targetVersion?.name).toBe("Test stretch");
    expect(after.rows.find((r) => r.key === "visitors")!.pctOfGoal).toBeCloseTo(78.8, 1);
  });

  it("settings change the projection", () => {
    const d = loadSeed();
    const base = E.projection(d, "2025-04-11").value.mid;
    const d2 = { ...d, settings: [{ key: "showup_mid", value: 0.5 }, { key: "walkin_assumption", value: 0 }] };
    expect(E.projection(d2, "2025-04-11").value.mid).toBe(1250);
    expect(base).not.toBe(1250);
  });
});

describe("copilot dispatcher", () => {
  const d = loadSeed();
  it("runs a tool with validated args and returns value/basis/caveats", () => {
    const r = E.executeTool(d, "funnel", { asOf: POST });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toHaveProperty("basis");
  });
  it("rejects unknown tools and bad args", () => {
    expect(E.executeTool(d, "nope", {}).ok).toBe(false);
    expect(E.executeTool(d, "funnel", { asOf: "yesterday" }).ok).toBe(false);
  });
  it("says when the data cannot answer", () => {
    const r = E.executeTool(d, "showupDrivers", { asOf: "2025-03-01" });
    expect(r.ok && (r.result as { value: unknown; caveats: string[] }).value).toBe(null);
    const p = E.executeTool(d, "person", { personId: "ZZZ999", asOf: POST });
    expect(p.ok && (p.result as { caveats: string[] }).caveats[0]).toMatch(/No person/);
  });
});
