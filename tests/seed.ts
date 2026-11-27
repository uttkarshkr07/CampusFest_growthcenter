import fs from "node:fs";
import path from "node:path";
import type { Dataset } from "@/lib/engine";

const dir = path.resolve(__dirname, "..", "data", "seed");
const read = (t: string) => JSON.parse(fs.readFileSync(path.join(dir, `${t}.json`), "utf8"));

/** Fresh copy of the seed so mutation tests never leak between tests. */
export function loadSeed(): Dataset {
  return {
    event: read("event"),
    targets: read("targets"),
    campaigns: read("campaigns"),
    daily_marketing: read("daily_marketing"),
    people: read("people"),
    interactions: read("interactions"),
    registrations: read("registrations"),
    registration_history: read("registration_history"),
    checkins: read("checkins"),
    sponsor_activations: read("sponsor_activations"),
    campaign_plan: [],
    team: [],
    tasks: [],
    settings: [],
    change_log: [],
    tickets: [],
    ticket_events: [],
  };
}
