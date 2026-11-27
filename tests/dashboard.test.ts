import { describe, expect, it } from "vitest";
import { loadSeed } from "./seed";
import * as E from "@/lib/engine";
import type { Dataset } from "@/lib/engine";

const DATES = ["2025-01-31", "2025-02-20", "2025-03-15", "2025-04-05", "2025-04-11"];

/** add `count` new external people who register for a campaign on one day */
function plantSpike(d: Dataset, campaign: string, day: string, count: number, status = "cancelled") {
  for (let i = 0; i < count; i++) {
    const pid = `ZP${i}`;
    const rid = `ZR${i}`;
    const at = `${day}T03:${String(i % 60).padStart(2, "0")}:00+05:30`;
    d.people.push({ person_id: pid, person_name: `Planted ${i}`, person_type: "external", first_seen_at: at, first_touch_source: "campaign", first_campaign_id: campaign, first_campaign_name: campaign, owner_id: null, owner_name: null } as never);
    d.registrations.push({ registration_id: rid, person_id: pid, person_name: `Planted ${i}`, campaign_id: campaign, campaign_name: campaign, registered_at: at, owner_id: null, owner_name: null } as never);
    d.registration_history.push({ history_id: `ZH${i}a`, registration_id: rid, person_id: pid, person_name: `Planted ${i}`, campaign_id: campaign, campaign_name: campaign, effective_at: at, status: "interested", owner_id: null, owner_name: null } as never);
    d.registration_history.push({ history_id: `ZH${i}b`, registration_id: rid, person_id: pid, person_name: `Planted ${i}`, campaign_id: campaign, campaign_name: campaign, effective_at: `${day}T20:00:00+05:30`, status, owner_id: null, owner_name: null } as never);
  }
}

describe("daily series", () => {
  const d = loadSeed();
  it.each(DATES)("matches the funnel's registered and confirmed counts on %s", (day) => {
    const last = E.dailySeries(d, day).value.points.at(-1)!;
    const s = E.snapshot(d, day);
    expect(last.day).toBe(day);
    expect(last.registered).toBe(s.personReg.size);
    expect(last.confirmed).toBe(E.externalStatusCounts(s, s.asOfMs).counts.confirmed);
  });
});

describe("landing forecast", () => {
  it("follows the formula on 15 Mar (original data)", () => {
    const d = loadSeed();
    const v = E.landingForecast(d, "2025-03-15").value;
    const f = v.forecast;
    expect(f.daysLeft).toBe(27);
    expect(v.daysToEvent).toBe(28);
    expect(Math.abs(f.mid - ((f.confirmed + f.pace.d14 * 27) * 0.75 + 100))).toBeLessThan(2);
    expect(f.low).toBeLessThanOrEqual(f.mid);
    expect(f.high).toBeGreaterThanOrEqual(f.mid);
    expect(v.goal).toBe(2200);
    expect(v.neededConfirmed).toBe(Math.ceil((2200 - 100) / 0.75));
  });

  it("does not change when rows after the as-of date change", () => {
    const a = loadSeed();
    const b = loadSeed();
    b.registrations = b.registrations.filter((r) => r.registered_at <= "2025-03-16");
    b.registration_history = b.registration_history.filter((h) => h.effective_at <= "2025-03-16");
    b.checkins = [];
    plantSpike(b, "C02", "2025-03-20", 80);
    for (const day of ["2025-02-20", "2025-03-15"]) {
      expect(E.landingForecast(b, day).value.forecast).toEqual(E.landingForecast(a, day).value.forecast);
      expect(E.landingForecast(b, day).value.chart.filter((x) => x.day <= day)).toEqual(E.landingForecast(a, day).value.chart.filter((x) => x.day <= day));
    }
  });

  it("forecast history: 2,050 actual, checkpoints from data known at the time", () => {
    const d = loadSeed();
    const h = E.forecastHistory(d, "2025-04-20").value;
    expect(h.actual).toBe(2050);
    expect(h.checkpoints.map((c) => c.label)).toEqual(["T-28", "T-14", "T-7", "T-1"]);
    const t14 = h.checkpoints.find((c) => c.label === "T-14")!;
    expect(t14.mid).toBe(E.landingForecast(d, t14.day).value.forecast.mid);
    expect(E.forecastHistory(d, "2025-03-20").value.checkpoints.map((c) => c.label)).toEqual(["T-28"]);
  });
});

describe("gate and leak funnel", () => {
  const d = loadSeed();
  it("post-event gate: 2,050 people, 725 both days, about 620 Day 2 first-timers", () => {
    const g = E.liveGate(d, "2025-04-20").value;
    expect(g.attendees).toBe(2050);
    expect(g.bothDays).toBe(725);
    expect(g.day2.people).toBe(1345);
    expect(g.day2.firstTimers).toBe(620);
  });
  it("post-event leak: 575 lost between confirmed and attended", () => {
    const l = E.leakFunnel(d, "2025-04-20").value;
    expect(l.steps.at(-1)!.lost).toBe(575);
    expect(l.steps[0].plannedPct).not.toBeNull();
  });
  it("briefing quotes the actual result after the fest", () => {
    expect(E.briefing(d, "2025-04-20").value.lines.join(" ")).toContain("2,050");
  });
});

describe("attention feed", () => {
  it("a planted sign-up spike becomes an item, and 7 days later it is flagged as not converting", () => {
    const clean = loadSeed();
    const d = loadSeed();
    plantSpike(d, "C06", "2025-03-03", 80);
    expect(E.attention(clean, "2025-03-04").value.items.some((i) => i.kind === "spike" && i.id.includes("C06"))).toBe(false);
    const early = E.attention(d, "2025-03-04").value.items.find((i) => i.kind === "spike" && i.id.includes("C06"));
    expect(early?.severity).toBe("watch");
    const later = E.attention(d, "2025-03-15").value.items.find((i) => i.kind === "spike" && i.id.includes("C06"));
    expect(later?.severity).toBe("act");
    expect(later?.detail).toMatch(/cancelled/);
  });

  it("raising one C04 spend row a lot creates an item that links to that row", () => {
    const d = loadSeed();
    const row = d.daily_marketing.find((r) => r.campaign_id === "C04" && r.activity_date === "2025-03-10")!;
    row.marketing_spend_inr = 90000;
    const items = E.attention(d, "2025-03-15").value.items;
    const it = items.find((i) => i.kind === "spend");
    expect(it?.link?.id).toBe(row.activity_id);
    expect(it?.severity).toBe("act");
    expect(E.attention(loadSeed(), "2025-03-15").value.items.some((i) => i.kind === "spend")).toBe(false);
  });

  it("sign-ups that stop on an active campaign are flagged", () => {
    const d = loadSeed();
    const busiest = E.campaignTable(loadSeed(), "2025-04-05").value.rows.sort((a, b) => b.registered - a.registered)[0].campaign_id;
    const drop = new Set(d.registrations.filter((r) => r.campaign_id === busiest && r.registered_at >= "2025-04-02" && r.registered_at < "2025-04-06").map((r) => r.registration_id));
    d.registrations = d.registrations.filter((r) => !drop.has(r.registration_id));
    d.registration_history = d.registration_history.filter((h) => !drop.has(h.registration_id));
    const items = E.attention(d, "2025-04-05").value.items;
    expect(items.some((i) => i.kind === "flatline" && i.id === `flat-${busiest}`)).toBe(true);
  });

  it("is ranked Act, Watch, Opportunity and the order is stable", () => {
    const d = loadSeed();
    const a = E.attention(d, "2025-03-15").value.items;
    const sev = a.map((i) => ["act", "watch", "opportunity"].indexOf(i.severity));
    expect([...sev].sort((x, y) => x - y)).toEqual(sev);
    expect(E.rankAttention([...a].reverse()).map((i) => i.id)).toEqual(a.map((i) => i.id));
  });

  it("'For you' keeps the team's items and the shared ones", () => {
    const d = loadSeed();
    const a = E.attention(d, "2025-04-12").value.items;
    const events = E.forTeams(a, ["events"]);
    expect(events.every((i) => i.team === "events" || i.team == null)).toBe(true);
    expect(events.some((i) => i.kind === "recover")).toBe(true);
    expect(E.forTeams(a, ["publicity"]).some((i) => i.kind === "recover")).toBe(false);
  });

  it("every link points to an allowed target", async () => {
    const { hrefFor } = await import("@/lib/copilot/targets");
    const d = loadSeed();
    for (const day of DATES.concat(["2025-04-12", "2025-04-20"]))
      for (const i of E.attention(d, day).value.items) if (i.link) expect(hrefFor(i.link.target, i.link.id), `${i.id}`).not.toBeNull();
  });
});
