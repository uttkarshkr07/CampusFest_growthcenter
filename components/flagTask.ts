import type { Dataset } from "@/lib/engine";
import type { flags as flagsFn } from "@/lib/engine";
import { blankTask, type TaskDraft } from "./TaskDialog";

type Flag = ReturnType<typeof flagsFn>["value"]["flags"][number];

const VERB = { scale: "Scale up", watch: "Review", stop: "Stop or rework" } as const;

/** Turn a scale/watch/stop flag into a prefilled task that records WHY it exists. */
export function taskFromFlag(f: Flag, data: Dataset, asOf: string): TaskDraft {
  const owner = data.campaigns.find((c) => c.campaign_id === f.campaign_id)?.owner_id ?? null;
  return blankTask(asOf, {
    title: `${VERB[f.level]}: ${f.campaign_name}`,
    description: f.reason,
    campaign_id: f.campaign_id,
    owner_id: owner,
    priority: f.level === "stop" ? "high" : f.level === "scale" ? "medium" : "low",
    origin: "rule",
    origin_ref: { rule: f.rule, level: f.level, asOf, reason: f.reason, metrics: f.metrics },
  });
}
