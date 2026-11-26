// The only places "Take me there" can point. The model picks a target by name, never a URL.
export const APP_TARGETS = {
  campaign: { help: "a campaign: edit status or budget (id = campaign id)", href: (id?: string) => `/campaigns${id ? `?focus=${id}` : ""}` },
  task: { help: "tasks: edit status, owner, due date or delete (id = task id)", href: (id?: string) => `/tasks${id ? `?focus=${id}` : ""}` },
  daily_marketing: { help: "daily marketing rows: spend and traffic (id = campaign id)", href: (id?: string) => `/data?tab=daily_marketing${id ? `&focus=${id}` : ""}` },
  targets: { help: "goal versions", href: () => "/data?tab=targets" },
  checkins: { help: "gate scan rows (id = person id)", href: (id?: string) => `/data?tab=checkins${id ? `&focus=${id}` : ""}` },
  settings: { help: "assumptions and decision thresholds", href: (id?: string) => `/settings${id ? `?focus=${id}` : ""}` },
  person: { help: "one person's timeline (id = person id)", href: (id?: string) => (id ? `/people/${encodeURIComponent(id)}` : "/people") },
  actions: { help: "full lists of people to act on", href: (id?: string) => `/actions${id ? `?cohort=${id}` : ""}` },
  whatif: { help: "the what-if simulator screen", href: () => "/whatif" },
} as const;

export type AppTarget = keyof typeof APP_TARGETS;
export const APP_TARGET_KEYS = Object.keys(APP_TARGETS) as AppTarget[];

export function hrefFor(target: string, id?: string): string | null {
  if (!(target in APP_TARGETS)) return null;
  const safe = id && /^[A-Za-z0-9_-]{1,60}$/.test(id) ? id : undefined;
  return APP_TARGETS[target as AppTarget].href(safe);
}
