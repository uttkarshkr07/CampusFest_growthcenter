"use client";

import { unavailableReason, useSwitchDataset } from "@/components/DatasetToggle";
import { DATASET_IDS, DATASET_LABEL, type DatasetId } from "@/lib/datasets";
import { MASCOT } from "@/lib/mascot";
import { useStore } from "@/lib/store";

const ABOUT: Record<DatasetId, { name: string; text: string }> = {
  original: { name: "Given data", text: "The 2025 data from the brief, as given. Use this to test the copilot." },
  simulated: { name: "New data", text: "A made-up run of the fest with our bets in place. It is a simulation, not real results." },
};

/** Asked the first time the copilot is opened: which dataset should it answer from? */
export default function DatasetChooser() {
  const { simulated, answerChooser } = useStore();
  const switchTo = useSwitchDataset();
  const choose = (id: DatasetId) => {
    switchTo(id);
    answerChooser();
  };
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <p className="text-[13px] font-semibold">Which data should {MASCOT.name} answer from?</p>
      {DATASET_IDS.map((id) => {
        const why = id === "simulated" ? unavailableReason(simulated) : "";
        return (
          <button
            key={id}
            type="button"
            disabled={!!why}
            onClick={() => choose(id)}
            className="block w-full rounded-lg border border-line bg-panel p-3 text-left hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line disabled:hover:bg-panel"
          >
            <div className="text-[13px] font-semibold">
              {ABOUT[id].name}: {DATASET_LABEL[id]}
              {why ? ` (${why})` : ""}
            </div>
            <div className="mt-0.5 text-[12px] text-muted">{ABOUT[id].text}</div>
          </button>
        );
      })}
      <p className="text-[12px] text-muted">The choice applies to the whole app. You can change it with the Data switch at the top. Each dataset has its own chats.</p>
    </div>
  );
}
