import { describe, expect, it } from "vitest";
import { loadSeed } from "./seed";
import * as E from "@/lib/engine";
import program from "@/lib/data/program.json";
import rulebook from "@/lib/data/events.json";

const withProgram = () => ({ ...loadSeed(), program: program as never });

describe("event list", () => {
  const v = E.eventList(withProgram(), "2025-04-05").value;

  it("lists every program session exactly once", () => {
    const ids = v.events.flatMap((e) => e.sessions.map((s) => s.event_id));
    const all = (program as { program_events: { event_id: string }[] }).program_events.map((e) => e.event_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...all].sort());
  });

  it("groups by genre in a fixed order", () => {
    const order = v.genres.map((g) => E.GENRE_ORDER.indexOf(g.genre as never));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("Group Dance has rules, both sessions and 100 points; Cartooning has none", () => {
    const gd = v.events.find((e) => e.id === "group-dance")!;
    expect(gd.rules?.rules.length).toBeGreaterThan(3);
    expect(gd.sessions.map((s) => s.event_id)).toEqual(["E002", "E039"]);
    expect(gd.points).toBe(100);
    expect(gd.scored).toBe(true);
    const ct = v.events.find((e) => e.id === "cartooning")!;
    expect(ct.rules).toBeNull();
    expect(ct.sessions).toHaveLength(1);
  });

  it("the adapted rules carry no Spring Fest names, emails or IDs, and every deadline is before the fest", () => {
    for (const e of rulebook.events as Record<string, unknown>[]) {
      const text = JSON.stringify({ about: e.about, rules: e.rules, judging: e.judging, submission: e.submission, name: e.name, teamLimit: e.teamLimit, timeLimit: e.timeLimit });
      expect(text, String(e.id)).not.toMatch(/Spring Fest|IIT Kharagpur|Kharagpur|SFID|sf2026|@gmail|Unstop|Hitch Hike/i);
      const sub = e.submission as { deadline: string } | null | undefined;
      if (sub) expect(sub.deadline < "2025-04-12", String(e.id)).toBe(true);
    }
    expect(JSON.stringify(rulebook.general.rules)).not.toMatch(/Spring Fest|Kharagpur/);
  });

  it("the Championship split matches the engine", () => {
    expect(rulebook.general.championship).toContain(`${E.POSITION_SHARE.map((x) => `${Math.round(x * 100)}%`)[1]}`);
  });
});
