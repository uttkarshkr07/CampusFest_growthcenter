// What each account may change. The database enforces the same rules (supabase/patch_session3a.sql);
// this copy only lets the screens say who can edit before someone tries.
import accounts from "./accounts.json";
import type { SourceTable } from "@/lib/engine/types";

export type Team = "publicity" | "sponsorship" | "events";

export interface Account {
  key: string;
  name: string;
  email: string;
  personId: string | null;
  reviewer: boolean;
  teams: Team[];
}

export const ACCOUNTS = accounts as Account[];

export interface Me {
  userId: string;
  name: string;
  personId: string | null;
  isReviewer: boolean;
  teams: Team[];
}

/** `null` means sign-in is switched off, so nothing is restricted. */
export type Viewer = Me | null;

export type EditableThing = SourceTable | "campaign_plan" | "settings";

const OWNER_TEAM: Partial<Record<EditableThing, Team>> = {
  campaigns: "publicity",
  campaign_plan: "publicity",
  daily_marketing: "publicity",
  targets: "publicity",
  settings: "publicity",
  checkins: "events",
};

export function canEdit(me: Viewer, thing: EditableThing): boolean {
  if (!me || me.isReviewer) return true;
  const team = OWNER_TEAM[thing];
  return !!team && me.teams.includes(team);
}

const firstName = (a: Account) => a.name.split(" ")[0];

export function whoCanEdit(thing: EditableThing): string {
  const team = OWNER_TEAM[thing];
  if (!team) return "Only the Reviewer account can edit this.";
  return `Only ${ACCOUNTS.filter((a) => a.teams.includes(team)).map(firstName).join(", ")} (${team}) or the Reviewer can edit this.`;
}

/** May this account act for a team (raise, decide or edit its tickets)? Any organiser may comment. */
export function canActFor(me: Viewer, team: string): boolean {
  return !me || me.isReviewer || (me.teams as string[]).includes(team);
}

export function whoCanActFor(team: string): string {
  return `Only ${ACCOUNTS.filter((a) => (a.teams as string[]).includes(team)).map(firstName).join(", ")} (${team}) or the Reviewer can do this.`;
}

export interface Owner {
  owner_id: string;
  owner_name: string;
  team: string;
}

/** A task belongs to its owner's team. Unassigned tasks are open to every organiser. */
export function canEditTask(me: Viewer, ownerId: string | null | undefined, team: Owner[]): boolean {
  if (!me || me.isReviewer || !ownerId) return true;
  const owner = team.find((t) => t.owner_id === ownerId);
  return !!owner && (me.teams as string[]).includes(owner.team);
}

export function taskBlockReason(ownerId: string, team: Owner[]): string {
  const owner = team.find((t) => t.owner_id === ownerId);
  return owner
    ? `${owner.owner_name} is in the ${owner.team} team. Only that team or the Reviewer can create or change their tasks.`
    : "Only the Reviewer can create or change this task.";
}
