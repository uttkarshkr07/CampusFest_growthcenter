import type { SettingRow } from "./types";

/** Assumptions and decision thresholds. Every value is an ASSUMPTION, editable in Settings. */
export interface EngineSettings {
  showup_low: number;
  showup_mid: number;
  showup_high: number;
  walkin_assumption: number;
  scale_cost_ratio: number;
  stop_cost_ratio: number;
  scale_min_showup: number;
  stop_max_showup: number;
  min_sample: number;
  whatif_penalty_base: number;
  whatif_penalty_stretch: number;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  showup_low: 0.65,
  showup_mid: 0.75,
  showup_high: 0.85,
  walkin_assumption: 100,
  scale_cost_ratio: 0.8,
  stop_cost_ratio: 1.5,
  scale_min_showup: 0.75,
  stop_max_showup: 0.55,
  min_sample: 30,
  whatif_penalty_base: 2,
  whatif_penalty_stretch: 1.5,
};

export const SETTING_HELP: Record<keyof EngineSettings, { label: string; help: string; kind: "pct" | "num" | "ratio" }> = {
  showup_low: { label: "Show-up rate, low case", help: "Share of confirmed registrants expected to attend, pessimistic case. Used only before the event.", kind: "pct" },
  showup_mid: { label: "Show-up rate, mid case", help: "Central show-up assumption for the pre-event projection.", kind: "pct" },
  showup_high: { label: "Show-up rate, high case", help: "Optimistic show-up assumption for the pre-event projection.", kind: "pct" },
  walkin_assumption: { label: "Walk-ins expected", help: "Verified external visitors with no registration, added to every projection case.", kind: "num" },
  scale_cost_ratio: { label: "Scale if cost ratio at or below", help: "A campaign's cost per attendee (or per confirmed, before the event) divided by the blended average. At or below this, and with enough show-up, it is flagged SCALE.", kind: "ratio" },
  stop_cost_ratio: { label: "Stop if cost ratio at or above", help: "At or above this multiple of the blended cost, the campaign is flagged STOP.", kind: "ratio" },
  scale_min_showup: { label: "Minimum show-up to scale", help: "After the event, a campaign needs at least this show-up (attended / registered) to be flagged SCALE.", kind: "pct" },
  stop_max_showup: { label: "Stop if show-up below", help: "After the event, show-up below this flags STOP regardless of cost.", kind: "pct" },
  min_sample: { label: "Minimum sample", help: "Campaigns with fewer registrations (or confirmed) than this are flagged WATCH: too little data to judge.", kind: "num" },
  whatif_penalty_base: { label: "What-if: cost of an extra attendee, cautious", help: "ASSUMPTION. Extra budget buys attendees at this multiple of the channel's current average cost, because channels saturate.", kind: "ratio" },
  whatif_penalty_stretch: { label: "What-if: cost of an extra attendee, optimistic", help: "ASSUMPTION. The optimistic version of the multiple above.", kind: "ratio" },
};

export function resolveSettings(rows: SettingRow[]): EngineSettings {
  const s: EngineSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows ?? []) {
    if (r.key in s) {
      const v = Number(r.value);
      if (Number.isFinite(v)) (s as unknown as Record<string, number>)[r.key] = v;
    }
  }
  return s;
}
