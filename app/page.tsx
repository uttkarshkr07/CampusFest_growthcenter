"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/store";
import { attention, briefing, budgetBurn, campaignTable, dataQuality, flags, forecastHistory, landingForecast, leakFunnel, liveGate, momentum, tasksView, ticketSummary, trackerFor, type AttentionItem } from "@/lib/engine";
import TaskDialog, { type TaskDraft } from "@/components/TaskDialog";
import AttentionFeed, { taskFromItem } from "@/components/dashboard/AttentionFeed";
import { FinalResult, ForecastHero, LiveGate } from "@/components/dashboard/Hero";
import { BetsStrip, Briefing, ChannelQuadrant, ExecutionPulse, LeakFunnel, WhatChanged } from "@/components/dashboard/Panels";

/**
 * Mission control: will we hit the goal, what needs attention, where are we losing people, which channels
 * to back, what changed. Every block is computed from the data as of the selected date.
 */
export default function Overview() {
  const { data, asOf, dataset } = useStore();
  const me = useAuth((s) => s.me);
  const [draft, setDraft] = useState<TaskDraft | null>(null);

  const r = useMemo(() => {
    if (!data) return null;
    const lf = landingForecast(data, asOf);
    const phase = lf.value.phase;
    return {
      lf,
      brief: briefing(data, asOf).value,
      gate: phase === "pre-event" ? null : liveGate(data, asOf),
      hist: phase === "post-event" ? forecastHistory(data, asOf) : null,
      leak: leakFunnel(data, asOf),
      table: campaignTable(data, asOf),
      flags: flags(data, asOf),
      burn: budgetBurn(data, asOf),
      mom7: momentum(data, asOf, { windowDays: 7 }),
      mom14: momentum(data, asOf, { windowDays: 14 }),
      tasks: tasksView(data, asOf).value,
      tickets: ticketSummary(data, asOf),
      issues: dataQuality(data).filter((i) => i.effect === "excluded" || i.effect === "check").length,
    };
  }, [data, asOf]);

  const tracker = useMemo(() => (data?.bets ? trackerFor(data, asOf).value : null), [data, asOf]);
  const att = useMemo(() => (data ? attention(data, asOf) : null), [data, asOf]);

  if (!data || !r || !att) return null;
  const { lf } = r;
  const phase = lf.value.phase;
  const k20 = tracker?.plan.kpis.find((k) => k.id === "K20");
  const myTeams = me && !me.isReviewer ? (me.teams as string[]) : null;

  return (
    <div className="space-y-4">
      <Briefing lines={r.brief.lines} phase={phase} daysToEvent={lf.value.daysToEvent} targetVersion={lf.value.targetVersion} issues={r.issues} simulated={dataset === "simulated"} />

      {/* Left: will we hit the goal, which channels. Right: what needs attention, where we lose people.
          On wide screens the left column sets the height; the attention list fills what is left above the
          funnel and scrolls, so both columns end on the same line. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="flex flex-col gap-4 xl:col-span-3">
          {phase === "pre-event" && <ForecastHero lf={lf} k20={k20 && k20.value != null ? k20.display : null} pending={r.leak.value.statusAtSnapshot.interested ?? 0} />}
          {phase === "live" && r.gate && <LiveGate gate={r.gate} goal={lf.value.goal} />}
          {phase === "post-event" && r.gate && r.hist && <FinalResult gate={r.gate} hist={r.hist} goal={lf.value.goal} targetVersion={lf.value.targetVersion} />}
          <ChannelQuadrant className="flex-1" table={r.table} flagsRes={r.flags} burn={r.burn} />
        </div>
        <div className="relative xl:col-span-2 xl:min-h-[760px]">
          <div className="flex flex-col gap-4 xl:absolute xl:inset-0">
            <AttentionFeed className="xl:min-h-0 xl:flex-1" key={`${me?.userId ?? "anon"}`} items={att.value.items} checks={att.value.checks} basis={att.basis} caveats={att.caveats} myTeams={myTeams} onTask={(i: AttentionItem) => setDraft(taskFromItem(i, asOf))} />
            <LeakFunnel className="shrink-0" leak={r.leak} />
          </div>
        </div>
      </div>

      {/* Same idea below: Execution and Bets set the height, What changed fills it and scrolls its list. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="relative xl:col-span-3 xl:min-h-[380px]">
          <WhatChanged className="xl:absolute xl:inset-0" mom7={r.mom7} mom14={r.mom14} />
        </div>
        <div className="flex flex-col gap-4 xl:col-span-2">
          <ExecutionPulse byStatus={r.tasks.byStatus} overdue={r.tasks.overdue} awaitingByTeam={r.tickets.awaitingByTeam} ticketsOverdue={r.tickets.overdue} />
          <BetsStrip className="flex-1" tracker={tracker} />
        </div>
      </div>

      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
