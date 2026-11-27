import { describe, expect, it } from "vitest";
import * as E from "@/lib/engine";
import { canActFor, ACCOUNTS, type Me } from "@/lib/auth/permissions";
import { runTurn } from "@/lib/copilot/loop";
import type { ModelReply, Part } from "@/lib/copilot/types";
import { loadSeed } from "./seed";

const NOTE = "SIMULATED SCENARIO: for this test only.";

/** One ticket raised on 15 Mar, accepted on 18 Mar, reworded on 25 Mar, done on 2 Apr; and a later one that is declined. */
function data(): E.Dataset {
  const d = loadSeed();
  const ticket = (id: string, patch: Partial<E.TicketRow>): E.TicketRow => ({
    id, title: "First title", details: "first details", from_team: "sponsorship", to_team: "publicity", requester_id: "T01", assignee_id: "T03",
    priority: "high", status: "done", raised_on: "2025-03-15", needed_by: "2025-03-22", simulation_note: null, ...patch,
  });
  const ev = (id: number, ticket_id: string, kind: E.TicketEventRow["kind"], story_date: string, body: string | null = null, before: E.TicketEventRow["before"] = null): E.TicketEventRow => ({ id, ticket_id, kind, body, before, actor_name: "A", story_date });
  d.tickets = [ticket("t1", { title: "Reworded title", details: "new details", needed_by: "2025-03-30", simulation_note: NOTE }), ticket("t2", { raised_on: "2025-04-01", needed_by: null, status: "declined", from_team: "publicity", to_team: "events" })];
  d.ticket_events = [
    ev(1, "t1", "raised", "2025-03-15"),
    ev(2, "t1", "accepted", "2025-03-18"),
    ev(3, "t1", "edited", "2025-03-25", null, { title: "First title", details: "first details", needed_by: "2025-03-22" }),
    ev(4, "t1", "comment", "2025-03-26", "a later comment"),
    ev(5, "t1", "in_progress", "2025-03-27"),
    ev(6, "t1", "done", "2025-04-02"),
    ev(7, "t2", "raised", "2025-04-01"),
    ev(8, "t2", "declined", "2025-04-03", "no room"),
  ];
  return d;
}
const one = (day: string, id = "t1") => E.ticketsAt(data(), day).find((t) => t.id === id);

describe("tickets as they stood on a date", () => {
  it("do not exist before they are raised", () => {
    expect(E.ticketsAt(data(), "2025-03-14")).toEqual([]);
    expect(E.ticketsAt(data(), "2025-03-15").map((t) => t.id)).toEqual(["t1"]);
  });
  it("follow their status history, with the decline reason", () => {
    expect([one("2025-03-17")!.status, one("2025-03-18")!.status, one("2025-03-27")!.status, one("2025-04-02")!.status]).toEqual(["open", "accepted", "in_progress", "done"]);
    expect(one("2025-04-02", "t2")!.status).toBe("open");
    expect(one("2025-04-03", "t2")!.declineReason).toBe("no room");
  });
  it("show the request as it was before a later edit, without later comments", () => {
    const early = one("2025-03-24")!;
    expect([early.title, early.details, early.needed_by, early.overdue]).toEqual(["First title", "first details", "2025-03-22", true]);
    expect(JSON.stringify(early)).not.toMatch(/Reworded|new details|later comment|2025-03-30/);
    expect([one("2025-03-25")!.title, one("2025-03-25")!.overdue]).toEqual(["Reworded title", false]);
  });
  it("counts what each team still has to answer", () => {
    expect(E.awaiting(E.ticketsAt(data(), "2025-03-15"), ["publicity"]).length).toBe(1);
    expect(E.awaiting(E.ticketsAt(data(), "2025-03-18"), ["publicity"]).length).toBe(0);
    expect(E.ticketSummary(data(), "2025-04-02").awaitingByTeam).toMatchObject({ publicity: 0, events: 1 });
  });
  it("is what the copilot's copy of the data holds", () => {
    const view = E.viewAsOf(data(), "2025-03-17");
    expect(view.tickets.map((t) => [t.id, t.status, t.title])).toEqual([["t1", "open", "First title"]]);
    expect(JSON.stringify([view.tickets, view.ticket_events])).not.toMatch(/Reworded|accepted|later comment/);
    const out = E.executeToolAsOf(data(), "tickets", { asOf: "2025-04-20" }, "2025-03-17");
    expect(JSON.stringify(out)).not.toMatch(/Reworded|in_progress|later comment/);
  });
  it("gives the copilot counts in the summary and the label with the text", () => {
    const summary = E.buildSummary(data(), "2025-03-15");
    expect(summary.teamTickets.awaitingByTeam.publicity).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("First title");
    const out = E.executeToolAsOf(data(), "tickets", { ticketId: "t1" }, "2025-03-15");
    expect(JSON.stringify(out)).toContain(NOTE);
    expect(JSON.stringify(out)).toContain("first details");
  });
});

describe("the simulation label travels with the ticket", () => {
  const turn = (steps: Part[][]) => {
    let i = 0;
    const d = data();
    return runTurn({
      question: "What does publicity owe sponsorship?",
      selectedDate: "2025-03-15",
      summary: E.buildSummary(d, "2025-03-15"),
      context: {},
      history: [],
      callModel: async (): Promise<ModelReply> => ({ parts: steps[i++], model: "fake" }),
      runTool: (name, args) => E.executeToolAsOf(d, name, args, "2025-03-15"),
    });
  };
  const read: Part[] = [{ functionCall: { name: "tickets", args: { ticketId: "t1" } } }];

  it("is added to an answer that left it out, once", async () => {
    const m = await turn([read, [{ text: "**Answer**\n- Publicity has one request." }]]);
    expect(m.text.startsWith(`**${NOTE}**`)).toBe(true);
    const kept = await turn([read, [{ text: `**Answer**\n- ${NOTE} One request.` }]]);
    expect(kept.text.split(NOTE).length).toBe(2);
  });
  it("is added to a task drafted for that ticket", async () => {
    const m = await turn([read, [{ text: `${NOTE} Draft below.` }, { functionCall: { name: "proposeTask", args: { title: "Announce", description: "Write it.", reason: "r", evidence: [], ticketId: "t1" } } }]]);
    const action = m.actions![0];
    expect(action.type === "task" && [action.proposal.ticket_id, action.proposal.description.startsWith(NOTE)]).toEqual(["t1", true]);
  });
  it("is not added when no simulated ticket was read", async () => {
    const m = await turn([[{ text: "**Answer**\n- Fine." }]]);
    expect(m.text).not.toContain("SIMULATED");
  });
});

describe("who may act for a team", () => {
  const as = (key: string): Me => {
    const a = ACCOUNTS.find((x) => x.key === key)!;
    return { userId: key, name: a.name, personId: a.personId, isReviewer: a.reviewer, teams: a.teams };
  };
  it("follows the approved table", () => {
    const teams = (key: string) => E.TICKET_TEAMS.filter((t) => canActFor(as(key), t));
    expect(teams("meera")).toEqual(["publicity", "sponsorship"]);
    expect(teams("arjun")).toEqual(["publicity"]);
    expect(teams("dev")).toEqual(["events"]);
    expect(teams("kabir")).toEqual(["sponsorship"]);
    expect(teams("reviewer")).toEqual([...E.TICKET_TEAMS]);
  });
});
