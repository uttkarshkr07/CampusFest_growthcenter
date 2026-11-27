import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeSponsorTool, sponsorActivations, sponsorBrand, sponsorBrands, sponsorCampaigns, sponsorOpportunities, sponsorOverview, type SponsorData } from "@/lib/engine/sponsor";

const at = (day: string, time = "10:00:00") => `${day}T${time}+05:30`;

/** A tiny made-up world, one case per counting rule. */
function world(): SponsorData {
  const brand = (id: string, created = at("2025-01-15")) => ({ brand_id: id, brand_name: `Brand ${id}`, industry: "x", owner_id: "T02", owner_name: "Owner", created_at: created });
  const touch = (id: string, attempt: string, b: string, contact: string, type: string, day: string, outcome = "sent") => ({ interaction_id: id, attempt_id: attempt, brand_id: b, contact_id: contact, sponsor_campaign_id: "S1", channel: "email", event_type: type, outcome, summary: null, occurred_at: at(day) });
  const qual = (id: string, b: string, status: string, day: string) => ({ history_id: id, brand_id: b, qualification_status: status, reason: null, sponsor_campaign_id: "S1", effective_at: at(day) });
  const opp = (id: string, b: string, support: string) => ({ opportunity_id: id, opportunity_name: `Deal ${id}`, brand_id: b, primary_contact_id: null, sponsor_campaign_id: "S1", support_type: support, created_at: at("2025-02-01") });
  const version = (id: string, o: string, b: string, stage: string, day: string, proposed: number, confirmed = 0) => ({ history_id: id, opportunity_id: o, brand_id: b, stage, proposed_value_inr: proposed, confirmed_value_inr: confirmed, owner_id: "T01", owner_name: "Owner", effective_at: at(day) });
  const first = touch("I1", "A1", "B1", "P1", "outreach_sent", "2025-02-01");
  return {
    targets: [
      { effective_at: at("2025-01-15"), qualified_brands_goal: 2, confirmed_partnerships_goal: 1, target_version: "first" },
      { effective_at: at("2025-03-15"), qualified_brands_goal: 4, confirmed_partnerships_goal: 2, target_version: "second" },
    ],
    brands: [brand("B1"), brand("B2"), brand("B3", at("2025-04-01"))],
    contacts: [],
    campaigns: [{ sponsor_campaign_id: "S1", campaign_name: "Email", channel: "email", objective: null, audience: null, owner_id: "T02", owner_name: "Owner", planned_start_at: null, planned_end_at: null, created_at: at("2025-01-15") }],
    interactions: [
      first,
      { ...first }, // an import copy
      touch("I2", "A1", "B1", "P1", "replied", "2025-02-02", "positive"),
      touch("I3", "A2", "B1", "P2", "outreach_sent", "2025-02-03"), // second contact, same brand
      touch("I4", "A3", "B2", "P3", "outreach_sent", "2025-02-04"),
      touch("I5", "A3", "B2", "P3", "replied", "2025-03-20", "positive"), // a later reply
    ],
    qualification: [qual("Q1", "B1", "unreviewed", "2025-01-15"), qual("Q2", "B1", "qualified", "2025-02-05"), qual("Q3", "B2", "engaged", "2025-02-06"), qual("Q4", "B2", "qualified", "2025-03-21")],
    opportunities: [opp("O1", "B1", "cash"), opp("O2", "B1", "in_kind")],
    opportunity_history: [
      version("H1", "O1", "B1", "proposal_sent", "2025-02-10", 100),
      version("H2", "O1", "B1", "partner_confirmed", "2025-03-01", 100, 90),
      version("H3", "O2", "B1", "negotiating", "2025-02-11", 50, 40), // a value on an unconfirmed deal
      version("H4", "O1", "B1", "withdrawn", "2025-04-01", 100, 0),
    ],
    activations: [],
  };
}

describe("sponsor counting rules", () => {
  const march = () => sponsorOverview(world(), "2025-03-15").value;

  it("counts copies once and keeps attempts, contacts and brands apart", () => {
    const v = march();
    expect(v.activity).toEqual({ attempts: 3, contactsInvolved: 3, events: 4, contactsOptedOut: 0 });
    expect(v.brands.withAnyTouch).toBe(2);
    expect(v.dataQuality.find((d) => d.table === "sponsor_interactions")).toMatchObject({ rows: 5, unique: 4, identicalCopies: 1 });
  });

  it("reads the latest version of a history and never sums versions", () => {
    const v = march();
    expect(v.stages.reduce((a, s) => a + s.opportunities, 0)).toBe(2);
    expect(v.targets.map((t) => [t.actual, t.goal])).toEqual([[1, 4], [1, 2]]);
  });

  it("counts reported value only for confirmed partnerships, split by support type", () => {
    expect(march().reportedValue).toEqual({ confirmedInr: 90, confirmedCashTypeInr: 90, confirmedInKindInr: 0, openProposedInr: 50 });
    expect(sponsorOverview(world(), "2025-03-15").caveats.join(" ")).toMatch(/NOT cash received/);
  });

  it("keeps a positive reply separate from qualification", () => {
    const v = sponsorOverview(world(), "2025-03-20").value;
    expect([v.brands.withPositiveReply, v.brands.qualifiedNow]).toEqual([2, 1]);
  });

  it("reads nothing after the selected date, and follows a later withdrawal", () => {
    const early = sponsorOverview(world(), "2025-03-14").value;
    expect([early.targetVersion, early.brands.onRecord, early.brands.replied]).toEqual(["first", 2, 1]);
    const late = sponsorOverview(world(), "2025-04-02").value;
    expect([late.targets[1].actual, late.reportedValue.confirmedInr, late.brands.onRecord]).toEqual([0, 0, 3]);
    expect(JSON.stringify(sponsorBrand(world(), "2025-03-15", "B2"))).not.toContain("2025-03-20");
  });

  it("credits campaigns without adding brands twice", () => {
    expect(sponsorCampaigns(world(), "2025-03-15").value.rows[0]).toMatchObject({ attempts: 3, brandsTouched: 2, brandsReplied: 1, qualifiedBrands: 1, opportunities: 2, confirmedPartnerships: 1, reportedConfirmedInr: 90 });
  });

  it("lists brands and opportunities at the date", () => {
    expect(sponsorBrands(world(), "2025-03-15", { qualification: "qualified" }).value.rows.map((r) => r.id)).toEqual(["B1"]);
    expect(sponsorOpportunities(world(), "2025-03-15", { stage: "negotiating" }).value.rows).toMatchObject([{ id: "O2", confirmedValueInr: 0, daysSinceUpdate: 32 }]);
    expect(sponsorBrand(world(), "2025-03-15", "nobody").value).toBeNull();
    expect(sponsorActivations(world(), "2025-03-15").value.rows).toEqual([]);
  });
});

describe("sponsor tool for the copilot", () => {
  it("pulls a later date back to the selected one", () => {
    const out = executeSponsorTool(world(), { report: "overview", asOf: "2025-04-20" }, "2025-03-15");
    expect(out.asOfUsed).toBe("2025-03-15");
    expect((out as { result: { caveats: string[] } }).result.caveats[0]).toMatch(/Later data is not available/);
  });
  it("says so when the records are not loaded or the request is wrong", () => {
    expect(executeSponsorTool(null, { report: "overview" }, "2025-03-15")).toMatchObject({ ok: false, error: expect.stringMatching(/not loaded/) });
    expect(executeSponsorTool(world(), { report: "payments" }, "2025-03-15").ok).toBe(false);
  });
});

// The real records are not in the repository. These figures were also computed separately from the workbook.
const FILE = "data/private/sponsor.json";
describe.skipIf(!existsSync(FILE))("sponsor records from the workbook", () => {
  const data = () => JSON.parse(readFileSync(FILE, "utf8")) as SponsorData;
  it("matches the separately computed figures on 15 Mar and 20 Apr", () => {
    const d = data();
    const mar = sponsorOverview(d, "2025-03-15").value;
    expect(mar.targets.map((t) => [t.actual, t.goal])).toEqual([[55, 55], [17, 28]]);
    expect(mar.reportedValue.confirmedInr).toBe(1505000);
    expect(mar.activity.attempts).toBe(287);
    const apr = sponsorOverview(d, "2025-04-20").value;
    expect(apr.targets.map((t) => [t.actual, t.goal])).toEqual([[60, 55], [24, 28]]);
    expect(apr.reportedValue).toMatchObject({ confirmedInr: 2240000, confirmedCashTypeInr: 2000000, confirmedInKindInr: 240000 });
    expect([apr.brands.onRecord, apr.activity.events]).toEqual([180, 950]);
  });
  it("keeps the model's lists short", () => {
    const out = executeSponsorTool(data(), { report: "brands" }, "2025-04-20");
    expect(out.ok && JSON.stringify(out.result).length).toBeLessThan(14000);
  });
});
