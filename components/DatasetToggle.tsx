"use client";

import { usePathname, useRouter } from "next/navigation";
import { useChat } from "@/lib/copilot/store";
import { DATASET_IDS, DATASET_LABEL, DATASET_SHORT, type DatasetId } from "@/lib/datasets";
import { useStore, type SimulatedStatus } from "@/lib/store";

/** why the simulated data cannot be chosen; empty when it can */
export function unavailableReason(status: SimulatedStatus): string {
  if (status === "ready") return "";
  if (status === "unchecked") return "could not be checked, reload the page";
  return "not loaded yet";
}

/** Switches the whole app. Locked while a change is saving or the copilot is answering. */
export function useSwitchDataset() {
  const router = useRouter();
  const path = usePathname();
  return (dataset: DatasetId) => {
    const before = useStore.getState().dataset;
    if (dataset === before || useChat.getState().busy) return;
    useStore.getState().setDataset(dataset);
    if (useStore.getState().dataset === before) return;
    // a person page or a highlighted record belongs to the other dataset: the same ID is someone else there
    if (path.startsWith("/people/")) router.replace("/people");
    else if (window.location.search) router.replace(path);
  };
}

export default function DatasetToggle() {
  const dataset = useStore((s) => s.dataset);
  const simulated = useStore((s) => s.simulated);
  const saving = useStore((s) => s.saving);
  const answering = useChat((s) => s.busy);
  const switchTo = useSwitchDataset();
  const locked = saving ? "Wait for the change to finish saving" : answering ? "Wait for the copilot to finish answering" : "";
  return (
    <div role="group" aria-label="Dataset" className="flex items-center gap-1.5">
      <span className="text-[12px] font-medium text-muted">Data</span>
      <div className="flex overflow-hidden rounded-md border border-line">
        {DATASET_IDS.map((id) => {
          const why = id === "simulated" ? unavailableReason(simulated) : "";
          const active = id === dataset;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              disabled={!active && (!!why || !!locked)}
              title={why ? `${DATASET_LABEL[id]}: ${why}` : locked || DATASET_LABEL[id]}
              onClick={() => switchTo(id)}
              className={`px-2 py-1 text-[12px] ${active ? "bg-ink font-semibold text-on-accent" : "bg-panel hover:bg-subtle disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-panel"}`}
            >
              {DATASET_SHORT[id]}
              {why && simulated !== "unknown" ? `: ${why}` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
