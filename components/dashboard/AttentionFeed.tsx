"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertOctagon, ArrowRight, CheckCircle2, Eye, ListPlus, MessageSquare, Sparkles } from "lucide-react";
import { forTeams, type AttentionCheck, type AttentionItem, type Severity } from "@/lib/engine";
import { hrefFor } from "@/lib/copilot/targets";
import { useChat } from "@/lib/copilot/store";
import { blankTask, type TaskDraft } from "@/components/TaskDialog";
import { Caveats } from "@/components/ui";

const SEV: Record<Severity, { label: string; icon: typeof Eye; cls: string; dot: string }> = {
  act: { label: "Act", icon: AlertOctagon, cls: "text-bad", dot: "bg-bad" },
  watch: { label: "Watch", icon: Eye, cls: "text-warn", dot: "bg-warn" },
  opportunity: { label: "Opportunity", icon: Sparkles, cls: "text-good", dot: "bg-good" },
};

const TEAM_LABEL: Record<string, string> = { publicity: "Publicity", events: "Events", sponsorship: "Sponsorship" };

export function taskFromItem(i: AttentionItem, asOf: string): TaskDraft {
  return blankTask(asOf, {
    title: i.task?.title ?? i.title,
    description: i.task?.description ?? i.detail,
    campaign_id: i.task?.campaign_id ?? null,
    owner_id: i.task?.owner_id ?? null,
    priority: i.task?.priority ?? (i.severity === "act" ? "high" : "medium"),
    origin: "rule",
    origin_ref: { source: "overview attention feed", item: i.id, kind: i.kind, severity: i.severity, asOf, reason: i.detail },
  });
}

export default function AttentionFeed({
  items,
  checks,
  basis,
  caveats,
  myTeams,
  onTask,
  className = "",
}: {
  items: AttentionItem[];
  checks: AttentionCheck[];
  basis: string[];
  caveats: string[];
  /** null = Reviewer or sign-in off: everything is theirs */
  myTeams: string[] | null;
  onTask: (i: AttentionItem) => void;
  className?: string;
}) {
  const [scope, setScope] = useState<"you" | "all">(myTeams ? "you" : "all");
  const [sev, setSev] = useState<Severity | "">("");
  const prefill = useChat((s) => s.prefill);
  const scoped = useMemo(() => (scope === "you" && myTeams ? forTeams(items, myTeams) : items), [items, scope, myTeams]);
  const counts = { act: 0, watch: 0, opportunity: 0 } as Record<Severity, number>;
  for (const i of scoped) counts[i.severity]++;
  const shown = scoped.filter((i) => !sev || i.severity === sev);

  return (
    <section className={`flex flex-col rounded-xl border border-line bg-panel ${className}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="mr-auto text-[13px] font-semibold">What needs attention</h2>
        {myTeams && (
          <div className="flex overflow-hidden rounded-md border border-line text-[12px]" role="group" aria-label="Whose items">
            {(["you", "all"] as const).map((k) => (
              <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k} className={`px-2 py-0.5 ${scope === k ? "bg-ink font-semibold text-on-accent" : "hover:bg-subtle"}`}>
                {k === "you" ? "For you" : "All"}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2 text-[12px]">
        {(Object.keys(SEV) as Severity[]).map((k) => {
          const S = SEV[k];
          return (
            <button key={k} onClick={() => setSev(sev === k ? "" : k)} aria-pressed={sev === k} className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${sev === k ? "border-ink bg-subtle-2 font-semibold" : "border-line hover:bg-subtle"}`}>
              <span className={`h-2 w-2 rounded-full ${S.dot}`} aria-hidden /> {S.label} <span className="tabular text-muted">{counts[k]}</span>
            </button>
          );
        })}
      </div>
      <ol className="max-h-[560px] min-h-0 flex-1 divide-y divide-line overflow-y-auto xl:max-h-none">
        {shown.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">Nothing here at this date{scope === "you" ? " for your team. Switch to All to see the rest." : "."}</li>}
        {shown.map((i) => {
          const S = SEV[i.severity];
          const Icon = S.icon;
          const href = i.link ? hrefFor(i.link.target, i.link.id) : null;
          return (
            <li key={i.id} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${S.cls}`} aria-label={S.label} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${S.cls}`}>{S.label}</span>
                    <span className="text-[11px] text-muted">{i.team ? TEAM_LABEL[i.team] : "Everyone"}</span>
                  </div>
                  <div className="text-[13px] font-semibold leading-snug">{i.title}</div>
                  <p className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-ink-2" title={i.detail}>
                    {i.detail}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {i.task && (
                      <button onClick={() => onTask(i)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[12px] hover:bg-subtle">
                        <ListPlus className="h-3.5 w-3.5" /> Task
                      </button>
                    )}
                    <button onClick={() => prefill(i.ask)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[12px] hover:bg-subtle" title="Opens the copilot with this question in the box. You press send.">
                      <MessageSquare className="h-3.5 w-3.5" /> Ask copilot
                    </button>
                    {href && (
                      <Link href={href} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-brand hover:bg-brand-soft">
                        {i.link!.label} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
        {checks.some((c) => c.ran && !c.found) && (
          <li className="px-4 py-3 text-[12px] text-muted">
            <div className="mb-1.5 font-medium">Also checked at this date, nothing found:</div>
            <ul className="flex flex-wrap gap-1.5">
              {checks
                .filter((c) => c.ran && !c.found)
                .map((c) => (
                  <li key={c.label} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-good" aria-hidden /> {c.label}
                  </li>
                ))}
            </ul>
            {checks.some((c) => !c.ran) && <p className="mt-1.5">Not checked on this dataset: {checks.filter((c) => !c.ran).map((c) => c.label.toLowerCase()).join(", ")} (no data for it).</p>}
          </li>
        )}
      </ol>
      <footer className="border-t border-line px-4 py-2">
        <Caveats items={caveats} basis={basis} />
      </footer>
    </section>
  );
}
