import { describe, expect, it } from "vitest";
import { ACCOUNTS, canEdit, canEditTask, whoCanEdit, type EditableThing, type Me } from "@/lib/auth/permissions";
import { isOrganiser } from "@/lib/auth/verify";

const team = [
  { owner_id: "T01", owner_name: "Riya Kapoor", team: "sponsorship" },
  { owner_id: "T03", owner_name: "Meera Iyer", team: "publicity" },
  { owner_id: "T06", owner_name: "Dev Malhotra", team: "events" },
];
const as = (key: string): Me => {
  const a = ACCOUNTS.find((x) => x.key === key)!;
  return { userId: key, name: a.name, personId: a.personId, isReviewer: a.reviewer, teams: a.teams };
};
const ALL: EditableThing[] = ["campaigns", "campaign_plan", "daily_marketing", "targets", "settings", "checkins", "people", "registrations", "registration_history", "interactions", "event", "sponsor_activations"];
const editable = (key: string) => ALL.filter((t) => canEdit(as(key), t));
const taskTeams = (key: string) => team.filter((t) => canEditTask(as(key), t.owner_id, team)).map((t) => t.team);

describe("permissions (the approved table)", () => {
  it("has the six organisers and the reviewer", () => {
    expect(ACCOUNTS.map((a) => a.key).sort()).toEqual(["arjun", "dev", "kabir", "meera", "nisha", "reviewer", "riya"]);
    expect(new Set(ACCOUNTS.map((a) => a.email)).size).toBe(7);
    for (const a of ACCOUNTS) expect(a.email).toMatch(/@campusfest\.example$/);
  });
  it("lets publicity edit campaigns, spend, targets and settings only", () => {
    for (const key of ["meera", "arjun", "nisha"]) expect(editable(key)).toEqual(["campaigns", "campaign_plan", "daily_marketing", "targets", "settings"]);
  });
  it("lets events edit check-ins only, and sponsorship no attendee data", () => {
    expect(editable("dev")).toEqual(["checkins"]);
    expect(editable("riya")).toEqual([]);
    expect(editable("kabir")).toEqual([]);
  });
  it("lets the reviewer, and an app with sign-in off, edit everything", () => {
    expect(editable("reviewer")).toEqual(ALL);
    expect(ALL.every((t) => canEdit(null, t))).toBe(true);
  });
  it("limits tasks to your own teams", () => {
    expect(taskTeams("meera")).toEqual(["sponsorship", "publicity"]);
    expect(taskTeams("arjun")).toEqual(["publicity"]);
    expect(taskTeams("dev")).toEqual(["events"]);
    expect(taskTeams("riya")).toEqual(["sponsorship"]);
    expect(taskTeams("reviewer")).toEqual(["sponsorship", "publicity", "events"]);
    expect(canEditTask(as("dev"), null, team)).toBe(true);
    expect(canEditTask(as("dev"), "T99", team)).toBe(false);
  });
  it("names who can make a blocked change", () => {
    expect(whoCanEdit("targets")).toBe("Only Meera, Arjun, Nisha (publicity) or the Reviewer can edit this.");
    expect(whoCanEdit("checkins")).toBe("Only Dev (events) or the Reviewer can edit this.");
    expect(whoCanEdit("people")).toMatch(/Reviewer/);
  });
});

describe("copilot sign-in check", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  const check = (header: string | null, fetcher: typeof fetch) => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon";
    return isOrganiser(header, fetcher);
  };
  it("accepts only a token that returns its own profile", async () => {
    expect(await check("Bearer good", reply(200, [{ user_id: "u" }]))).toBe(true);
    expect(await check("Bearer stranger", reply(200, []))).toBe(false);
    expect(await check("Bearer expired", reply(401, { message: "expired" }))).toBe(false);
    expect(await check(null, reply(200, [{ user_id: "u" }]))).toBe(false);
  });
});
