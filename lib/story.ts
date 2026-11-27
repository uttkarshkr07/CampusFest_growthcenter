// The dates the app moves between, read from the data so a new timeline needs no code change.
import { istDay, toMs } from "@/lib/engine/time";
import type { Dataset } from "@/lib/engine/types";

export interface Story {
  min: string;
  max: string;
  /** the date "Today in story" selects */
  today: string;
  /** first day of the event */
  day1: string;
  /** the last date in the data */
  post: string;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function storyDates(data: Dataset): Story {
  const event = data.event.find((e) => !e._deleted);
  const day1 = event?.event_starts_at ? istDay(toMs(event.event_starts_at)) : "";
  const min = String(event?.history_start ?? day1).slice(0, 10);
  const max = String(event?.history_end ?? day1).slice(0, 10);
  // "today": the optional setting story_today, else the last plan change before the event
  const chosen = data.settings.find((s) => s.key === "story_today")?.value;
  const lastPlan = data.targets
    .filter((t) => !t._deleted && Number.isFinite(toMs(t.effective_at)))
    .map((t) => istDay(toMs(t.effective_at)))
    .filter((d) => d < day1 && d >= min)
    .sort()
    .at(-1);
  const today = isDay(chosen) && chosen >= min && chosen <= max ? chosen : (lastPlan ?? min);
  return { min, max, today, day1, post: max };
}
