"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CartesianGrid, LabelList, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Database } from "lucide-react";
import { VERDICT_LABEL, type budgetBurn, type campaignTable, type flags, type leakFunnel, type momentum, type TrackerValue, type Verdict } from "@/lib/engine";
import { Badge, Caveats } from "@/components/ui";
import { useChartColors } from "@/lib/theme";
import { fmtDateTime, inr, num, pct } from "@/lib/format";
import { Section } from "./Hero";

// ---------------------------------------------------------------------------
export function Briefing({ lines, phase, daysToEvent, targetVersion, issues, simulated }: { lines: string[]; phase: string; daysToEvent: number; targetVersion: string | null; issues: number; simulated: boolean }) {
  const chip = phase === "pre-event" ? `T-${daysToEvent} days` : phase === "live" ? "Fest live" : "After the fest";
  return (
    <section className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-navy px-2 py-0.5 font-semibold text-panel">{chip}</span>
        {targetVersion && (
          <span className="max-w-[28rem] truncate rounded-full border border-line px-2 py-0.5 text-muted" title={`Targets in force: ${targetVersion}`}>
            Targets: {targetVersion}
          </span>
        )}
        {simulated && <span className="rounded-full bg-warn-soft px-2 py-0.5 font-semibold text-warn">Simulated run</span>}
        <Link href="/data?tab=quality" className="ml-auto inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-muted hover:text-ink" title="Records the engine leaves out, reads differently or flags">
          <Database className="h-3 w-3" /> Data quality: {issues ? `${num(issues)} kinds of issue` : "no issues"}
        </Link>
      </div>
      <p className="text-[15px] leading-relaxed">
        {lines.map((l, i) => (
          <span key={i} className={i === 0 ? "font-semibold" : ""}>
            {l}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
type Leak = ReturnType<typeof leakFunnel>;
export function LeakFunnel({ leak, className }: { leak: Leak; className?: string }) {
  const v = leak.value;
  const top = Math.max(1, v.stages[0]?.count ?? 1);
  const judged = v.phase === "live" ? v.steps.slice(0, -1) : v.steps;
  const worst = judged.reduce<(typeof v.steps)[number] | null>((a, b) => (!a || b.lost > a.lost ? b : a), null);
  return (
    <Section className={className} title="Where are we losing people?" badge={<Badge kind="sourced">FROM RECORDS</Badge>}>
      <div className="space-y-1">
        {v.stages.map((s, i) => {
          const step = i > 0 ? v.steps[i - 1] : null;
          const isWorst = step && worst && step === worst && step.lost > 0;
          return (
            <div key={s.key}>
              {step && (
                <div className={`flex flex-wrap items-center gap-x-3 py-0.5 pl-3 text-[12px] ${isWorst ? "font-semibold text-bad" : "text-muted"}`}>
                  <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                  <span className="tabular">{pct(step.conversionPct)} carry on</span>
                  {step.plannedPct != null && <span className="tabular">plan {pct(step.plannedPct)}</span>}
                  <span className="tabular">{num(step.lost)} lost here</span>
                  {step.cohort && step.lost > 0 && (
                    <Link href={`/actions?cohort=${step.cohort}`} className="font-medium text-brand">
                      who
                    </Link>
                  )}
                  {v.phase === "live" && i === v.stages.length - 1 && <span>(partial: the fest is on)</span>}
                </div>
              )}
              <div className="grid grid-cols-[150px_1fr] items-center gap-3" title={s.definition}>
                <div className="text-[13px]">{s.label}</div>
                <div className="h-6 rounded bg-subtle-2">
                  <div className="flex h-full items-center rounded bg-brand px-2 text-[12px] font-semibold text-on-accent" style={{ width: `${Math.max(6, (s.count / top) * 100)}%` }}>
                    {num(s.count)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div className="rounded-lg bg-subtle px-2.5 py-1.5">
          <div className="text-[11px] text-muted">Interested, not confirmed</div>
          <div className="tabular font-medium">{num(v.statusAtSnapshot.interested)}</div>
        </div>
        <div className="rounded-lg bg-subtle px-2.5 py-1.5">
          <div className="text-[11px] text-muted">Waitlisted / cancelled</div>
          <div className="tabular font-medium">
            {num(v.statusAtSnapshot.waitlisted)} / {num(v.statusAtSnapshot.cancelled)}
          </div>
        </div>
        <div className="rounded-lg bg-subtle px-2.5 py-1.5">
          <div className="text-[11px] text-muted">{v.phase === "pre-event" ? "Walk-ins" : "Walk-ins (no registration)"}</div>
          <div className="tabular font-medium">{v.phase === "pre-event" ? "after the fest starts" : num(v.walkIns)}</div>
        </div>
      </div>
      <Caveats items={leak.caveats} basis={leak.basis} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
type Table = ReturnType<typeof campaignTable>;
type Flags = ReturnType<typeof flags>;
type Burn = ReturnType<typeof budgetBurn>;
interface Dot {
  id: string;
  name: string;
  short: string;
  x: number;
  y: number;
  z: number;
  level: "scale" | "watch" | "stop";
  reason: string;
}

export function ChannelQuadrant({ table, flagsRes, burn, className }: { table: Table; flagsRes: Flags; burn: Burn; className?: string }) {
  const c = useChartColors();
  const router = useRouter();
  const post = table.value.phase === "post-event";
  const level = new Map(flagsRes.value.flags.map((f) => [f.campaign_id, f]));
  const blended = post ? table.value.totals.blendedInrPerAttendee : table.value.totals.blendedInrPerConfirmed;
  const th = flagsRes.value.thresholds;
  const dots: Dot[] = table.value.rows
    .map((r) => {
      const x = post ? r.inrPerAttendee : r.inrPerConfirmed;
      const y = post ? r.showUpPct : r.registered ? (r.confirmed / r.registered) * 100 : null;
      const f = level.get(r.campaign_id);
      return x != null && y != null && r.cost > 0 ? { id: r.campaign_id, name: r.campaign_name, short: r.campaign_name.split(" ")[0], x, y: Math.round(y * 10) / 10, z: r.cost, level: f?.level ?? "watch", reason: f?.reason ?? "" } : null;
    })
    .filter((d): d is Dot => d != null);
  const series: { level: Dot["level"]; name: string; color: string; shape: "circle" | "diamond" | "triangle" }[] = [
    { level: "scale", name: "Scale", color: c.good, shape: "circle" },
    { level: "watch", name: "Watch", color: c.neutral, shape: "diamond" },
    { level: "stop", name: "Stop", color: c.bad, shape: "triangle" },
  ];
  const b = burn.value;
  const unit = post ? "actual attendee" : "confirmed";
  const xMax = Math.max(1, ...dots.map((d) => d.x), blended ? blended * th.stop_cost_ratio : 0);
  const yMin = Math.max(0, Math.floor((Math.min(100, ...dots.map((d) => d.y)) - 8) / 10) * 10);
  const xTop = Math.ceil((xMax * 1.12) / 50) * 50;
  for (const d of dots) if (d.x > xTop * 0.8) d.short = `<${d.short}`;
  const sorted = [...dots].sort((a, b) => a.x - b.x);
  return (
    <Section className={className} title="Which channels do we back?" badge={<Badge kind={post ? "sourced" : "assumption"}>{post ? "AFTER THE FEST" : "PROXY BEFORE THE FEST"}</Badge>}>
      {dots.length === 0 ? (
        <p className="text-[13px] text-muted">No campaign has spend and people yet at this date.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 4, right: 16, top: 10, bottom: 18 }}>
              <CartesianGrid stroke={c.grid} />
              <XAxis type="number" dataKey="x" domain={[0, xTop]} name={`INR per ${unit}`} tick={{ fontSize: 11 }} stroke={c.grid} tickFormatter={(x) => `₹${num(Number(x))}`} label={{ value: `Cost per ${unit} (lower is better)`, position: "insideBottom", offset: -10, fontSize: 11, fill: c.axis }} />
              <YAxis type="number" dataKey="y" name={post ? "Show-up" : "Confirmed of registered"} unit="%" tick={{ fontSize: 11 }} width={44} stroke={c.grid} domain={[yMin, 100]} allowDataOverflow />
              <ZAxis type="number" dataKey="z" range={[60, 600]} name="Spend" />
              {blended != null && <ReferenceLine x={blended * th.scale_cost_ratio} stroke={c.good} strokeDasharray="4 3" label={{ value: `scale ${th.scale_cost_ratio}x`, position: "insideBottomLeft", fontSize: 10, fill: c.axis }} />}
              {blended != null && <ReferenceLine x={blended * th.stop_cost_ratio} stroke={c.bad} strokeDasharray="4 3" label={{ value: `stop ${th.stop_cost_ratio}x`, position: "insideTopRight", fontSize: 10, fill: c.axis }} />}
              {post && <ReferenceLine y={th.stop_max_showup * 100} stroke={c.bad} strokeOpacity={0.5} strokeDasharray="2 3" />}
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  const d = payload?.[0]?.payload as Dot | undefined;
                  if (!d) return null;
                  return (
                    <div className="max-w-64 rounded-md border border-line bg-panel px-3 py-2 text-[12px] shadow-lg">
                      <div className="font-semibold">{d.name}</div>
                      <div className="tabular">
                        {inr(d.x)} per {unit} · {pct(d.y)} {post ? "show-up" : "confirmed"} · spend {inr(d.z)}
                      </div>
                      <div className="mt-1 text-muted">{d.reason}</div>
                      <div className="mt-1 text-brand">Click to open the campaign</div>
                    </div>
                  );
                }}
              />
              <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
              {series.map((s) => (
                <Scatter key={s.level} name={s.name} data={dots.filter((d) => d.level === s.level)} fill={s.color} shape={s.shape} isAnimationActive={false} onClick={(d: unknown) => router.push(`/campaigns?focus=${(d as { id?: string; payload?: Dot }).payload?.id ?? (d as Dot).id}`)} cursor="pointer">
                  <LabelList dataKey="short" content={(props) => <PointLabel {...(props as LabelProps)} fill={c.axis} />} />
                </Scatter>
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
      {sorted.length > 0 && (
        <table className="mt-2 w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase text-muted">
              <th className="py-1 font-medium">Campaign</th>
              <th className="py-1 text-right font-medium">Cost per {unit}</th>
              <th className="py-1 text-right font-medium">{post ? "Show-up" : "Confirmed"}</th>
              <th className="py-1 text-right font-medium">Spend</th>
              <th className="py-1 text-right font-medium">Flag</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.id} className="border-b border-line/60">
                <td className="py-1">
                  <Link href={`/campaigns?focus=${d.id}`} className="hover:text-brand">
                    {d.name}
                  </Link>
                </td>
                <td className="tabular py-1 text-right">{inr(d.x)}</td>
                <td className="tabular py-1 text-right">{pct(d.y)}</td>
                <td className="tabular py-1 text-right">{inr(d.z, { compact: true })}</td>
                <td className={`py-1 text-right text-[11px] font-semibold uppercase ${d.level === "stop" ? "text-bad" : d.level === "scale" ? "text-good" : "text-muted"}`}>{d.level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-1 text-[12px] text-muted">
        Bubble size = spend. Dashed lines are the scale and stop rules from Settings, drawn at {blended != null ? `the blended ${inr(blended)} per ${unit}` : "the blended cost"}.
        {!post && " Before the fest, cost per confirmed stands in for cost per attendee: it ignores channel differences in show-up."}
      </p>
      <div className="mt-3 rounded-lg bg-subtle px-3 py-2 text-[12px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Budget: <b className="tabular">{inr(b.spent)}</b> spent{b.budget != null && <> of {inr(b.budget)} ({pct(b.usedPct)})</>}
          </span>
          {b.daysLeft > 0 && b.budget != null && (
            <span className={b.projectedOver != null && b.projectedOver > 0 ? "font-semibold text-bad" : "text-muted"}>
              At {inr(b.perDay)} a day (last 14 days): {inr(b.projected)} by Day 1, {b.projectedOver! > 0 ? `${inr(b.projectedOver)} over` : `${inr(-b.projectedOver!)} under`}
            </span>
          )}
        </div>
        {b.budget != null && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-subtle-2">
            <div className={`h-full ${(b.usedPct ?? 0) > 100 ? "bg-bad" : "bg-brand"}`} style={{ width: `${Math.min(100, b.usedPct ?? 0)}%` }} />
          </div>
        )}
      </div>
      <Caveats items={[...new Set([...flagsRes.caveats, ...burn.caveats])]} basis={[...new Set([...flagsRes.basis, ...burn.basis])]} />
    </Section>
  );
}

interface LabelProps {
  x?: number;
  y?: number;
  value?: string;
  viewBox?: { x: number; y: number; width: number; height: number };
}

/** a short name beside the point; a leading "<" puts it on the left, so names near the right edge are not cut off */
function PointLabel({ x = 0, y = 0, value, fill }: LabelProps & { fill: string }) {
  const left = String(value ?? "").startsWith("<");
  return (
    <text x={left ? x - 10 : x + 10} y={y + 4} fontSize={10} fill={fill} textAnchor={left ? "end" : "start"}>
      {String(value ?? "").replace(/^</, "")}
    </text>
  );
}

// ---------------------------------------------------------------------------
type Mom = ReturnType<typeof momentum>;
export function WhatChanged({ mom7, mom14, className }: { mom7: Mom; mom14: Mom; className?: string }) {
  const [w, setW] = useState<7 | 14>(7);
  const m = (w === 7 ? mom7 : mom14).value;
  const delta = m.total - m.totalPrev;
  const movers = m.rows.filter((r) => r.delta !== 0);
  const edits = [...m.recentEdits].reverse().slice(0, 4);
  return (
    <Section
      className={`flex flex-col ${className ?? ""}`}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      title="What changed?"
      badge={
        <div className="flex overflow-hidden rounded-md border border-line text-[12px]" role="group" aria-label="Window">
          {([7, 14] as const).map((k) => (
            <button key={k} onClick={() => setW(k)} aria-pressed={w === k} className={`px-2 py-0.5 ${w === k ? "bg-ink font-semibold text-on-accent" : "hover:bg-subtle"}`}>
              {k} days
            </button>
          ))}
        </div>
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="tabular text-2xl font-bold">{num(m.total)}</span>
        <span className="text-[12px] text-muted">registrations in the last {w} days</span>
        <span className={`tabular ml-auto text-[13px] font-semibold ${delta >= 0 ? "text-good" : "text-bad"}`}>
          {delta >= 0 ? "+" : ""}
          {num(delta)} vs the {w} before{m.totalPrev ? ` (${delta >= 0 ? "+" : ""}${pct((delta / m.totalPrev) * 100, 0)})` : ""}
        </span>
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Campaigns that moved ({movers.length})
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-line/70 overflow-y-auto text-[12px]">
        {movers.length === 0 && <li className="py-1.5 text-muted">No campaign moved.</li>}
        {movers.map((r) => (
          <li key={r.campaign_id} className="flex items-center gap-2 py-1.5">
            {r.delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-good" aria-label="up" /> : <ArrowDownRight className="h-3.5 w-3.5 text-bad" aria-label="down" />}
            <Link href={`/campaigns?focus=${r.campaign_id}`} className="font-medium hover:text-brand">
              {r.campaign_name}
            </Link>
            <span className="tabular ml-auto">
              {num(r.registrationsPrev)} <ArrowRight className="inline h-3 w-3" /> {num(r.registrations)}
            </span>
            <span className="tabular w-28 text-right text-muted">spend {inr(r.spend, { compact: true })}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Recent data edits</div>
      {edits.length === 0 ? (
        <p className="text-[12px] text-muted">None. Edits made in the app appear here, because they move numbers too.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-[12px]">
          {edits.map((e) => (
            <li key={String(e.id)} className="flex gap-2">
              <span className="text-muted">{fmtDateTime(e.changed_at)}</span>
              <span className="truncate">
                {e.table_name} {e.row_ref}: {e.field} {String(e.old_value ?? "empty")} <ArrowRight className="inline h-3 w-3" /> {String(e.new_value ?? "empty")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Caveats items={mom7.caveats} basis={(w === 7 ? mom7 : mom14).basis} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
const CHIP: Record<Verdict, string> = {
  scale: "bg-good-soft text-good border-good/30",
  change: "bg-warn-soft text-warn border-warn/30",
  stop: "bg-bad-soft text-bad border-bad/30",
  too_early: "bg-subtle-2 text-muted border-line",
  not_enough_data: "bg-subtle-2 text-muted border-line",
  not_applicable: "bg-panel text-muted border-line",
  tracking: "bg-brand-soft text-brand border-brand/30",
};

export function BetsStrip({ tracker, className }: { tracker: TrackerValue | null; className?: string }) {
  return (
    <Section className={className} title="Bets" badge={tracker?.hasBetData ? <Badge kind="assumption">SIMULATED RUN</Badge> : undefined}>
      {!tracker?.hasBetData ? (
        <p className="text-[13px] text-muted">
          The five bets are tracked on the simulated run: the original 2025 data has no squads, passes or contingents. <Link href="/bets" className="font-medium text-brand">Open the bet tracker</Link>
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {tracker.bets.map((b) => {
              const v = b.headline?.verdict ?? "too_early";
              return (
                <li key={b.bet_id}>
                  <Link href={`/bets?focus=${b.bet_id}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[13px] hover:bg-subtle">
                    <span className={`inline-flex w-24 justify-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${CHIP[v]}`}>{VERDICT_LABEL[v]}</span>
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {b.budget != null && (
                      <span className={`tabular text-[12px] ${b.overBudget ? "font-semibold text-bad" : "text-muted"}`}>
                        {inr(b.spent ?? 0, { compact: true })} / {inr(b.budget, { compact: true })}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className={`mt-2 text-[12px] ${tracker.spend.over ? "font-semibold text-bad" : "text-muted"}`}>
            Media plus bets: {inr(tracker.spend.total)} of the {inr(tracker.spend.cap)} cap.
          </p>
        </>
      )}
    </Section>
  );
}

export function ExecutionPulse({ byStatus, overdue, awaitingByTeam, ticketsOverdue, className }: { byStatus: Record<string, number>; overdue: number; awaitingByTeam: Record<string, number>; ticketsOverdue: number; className?: string }) {
  const cell = (label: string, value: number, bad?: boolean, href?: string) => (
    <Link href={href ?? "/tasks"} className="rounded-lg bg-subtle px-2.5 py-1.5 hover:bg-subtle-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`tabular text-[15px] font-semibold ${bad && value ? "text-bad" : ""}`}>{num(value)}</div>
    </Link>
  );
  return (
    <Section className={className} title="Execution">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Tasks</div>
      <div className="mt-1 grid grid-cols-5 gap-1.5">
        {cell("To do", byStatus.todo ?? 0)}
        {cell("Doing", byStatus.doing ?? 0)}
        {cell("Blocked", byStatus.blocked ?? 0, true)}
        {cell("Done", byStatus.done ?? 0)}
        {cell("Overdue", overdue, true)}
      </div>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Tickets waiting for an answer</div>
      <div className="mt-1 grid grid-cols-4 gap-1.5">
        {cell("Publicity", awaitingByTeam.publicity ?? 0, false, "/tickets")}
        {cell("Events", awaitingByTeam.events ?? 0, false, "/tickets")}
        {cell("Sponsorship", awaitingByTeam.sponsorship ?? 0, false, "/tickets")}
        {cell("Overdue", ticketsOverdue, true, "/tickets")}
      </div>
    </Section>
  );
}
