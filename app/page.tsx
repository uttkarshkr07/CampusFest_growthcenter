"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { campaignTable, dataHealth, flags, funnel, pace, projection, targetsVsActuals } from "@/lib/engine";
import { Badge, Button, Card, Caveats, FlagChip, PageHeader } from "@/components/ui";
import TaskDialog, { type TaskDraft } from "@/components/TaskDialog";
import { taskFromFlag } from "@/components/flagTask";
import { fmtDate, inr, num, pct, shortDay } from "@/lib/format";

export default function Overview() {
  const { data, asOf } = useStore();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const r = useMemo(() => {
    if (!data) return null;
    return {
      tva: targetsVsActuals(data, asOf),
      fun: funnel(data, asOf),
      pace: pace(data, asOf),
      proj: projection(data, asOf),
      flags: flags(data, asOf),
      health: dataHealth(data, asOf),
      table: campaignTable(data, asOf),
    };
  }, [data, asOf]);
  if (!data || !r) return null;
  const { tva, fun, proj, health } = r;
  const phaseLabel = { "pre-event": "Before the event: attendance is projected", live: "Event in progress", "post-event": "After the event: actual attendance" }[fun.value.phase];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        subtitle={
          <>
            {phaseLabel}. Targets in force: <b>{tva.value.targetVersion?.name ?? "none"}</b>
            {tva.value.targetVersion && <> (from {fmtDate(tva.value.targetVersion.effectiveAt)})</>}.
          </>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tva.value.rows.map((row) => {
          const money = row.key === "spend";
          const p = row.pctOfGoal ?? 0;
          const bar = money ? (p > 100 ? "bg-bad" : "bg-brand") : p >= 100 ? "bg-good" : p >= 85 ? "bg-warn" : "bg-bad";
          return (
            <div key={row.key} className="rounded-lg border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[12px] font-medium text-muted">{row.label}</div>
                {row.projected ? <Badge kind="projected" /> : <Badge kind="sourced" />}
              </div>
              <div className="tabular mt-1.5 text-2xl font-semibold">{money ? inr(row.actual) : num(row.actual)}</div>
              <div className="tabular mt-0.5 text-[12px] text-muted">
                {row.goal != null ? (
                  <>
                    {money ? "budget" : "goal"} {money ? inr(row.goal) : num(row.goal)} · {pct(row.pctOfGoal)}
                  </>
                ) : (
                  "no target in force"
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
                <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, p)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Funnel */}
        <Card className="xl:col-span-3" title="Growth funnel" help="Each stage counts distinct external people. The red stage is the biggest absolute leak between two consecutive stages.">
          <div className="space-y-2">
            {fun.value.stages.map((s, i) => {
              const top = fun.value.stages[0].count || 1;
              const prev = i > 0 ? fun.value.stages[i - 1] : null;
              const isLeak = fun.value.biggestLeak && fun.value.biggestLeak.to === s.label;
              return (
                <div key={s.key} className="grid grid-cols-[150px_1fr_120px] items-center gap-3" title={s.definition}>
                  <div className="text-[13px]">{s.label}</div>
                  <div className="h-6 rounded bg-slate-100">
                    <div className={`flex h-full items-center rounded px-2 text-[12px] font-semibold text-white ${isLeak ? "bg-bad" : "bg-brand"}`} style={{ width: `${Math.max(4, (s.count / top) * 100)}%` }}>
                      {num(s.count)}
                    </div>
                  </div>
                  <div className={`tabular text-right text-[12px] ${isLeak ? "font-semibold text-bad" : "text-muted"}`}>{prev ? `${pct((s.count / Math.max(1, prev.count)) * 100)} of previous` : ""}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
            <Mini label="Walk-ins (no registration)" value={num(fun.value.walkIns)} />
            <Mini label="Actual attendees" value={fun.value.phase === "pre-event" ? "not yet" : num(fun.value.actualAttendees)} strong />
            <Mini label="Confirmed no-shows" value={fun.value.confirmedNoShows == null ? "n/a" : num(fun.value.confirmedNoShows)} />
            <Mini label="Cancelled / waitlisted / interested" value={`${num(fun.value.statusAtSnapshot.cancelled)} / ${num(fun.value.statusAtSnapshot.waitlisted)} / ${num(fun.value.statusAtSnapshot.interested)}`} />
          </div>
          {fun.value.biggestLeak && (
            <p className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">
              Biggest leak: <b>{fun.value.biggestLeak.from}</b> to <b>{fun.value.biggestLeak.to}</b>, {num(fun.value.biggestLeak.lost)} people lost ({pct(fun.value.biggestLeak.conversion)} convert).
            </p>
          )}
          <Caveats items={fun.caveats} basis={fun.basis} />
        </Card>

        {/* Projection */}
        <Card className="xl:col-span-2" title={proj.value.mode === "projection" ? "Projected verified visitors" : "Actual vs projection"} help="Before the event: confirmed external registrants x show-up assumption + walk-in assumption (both editable in Settings). After: the actual, and how the projection made the day before the event performed." right={<Badge kind={proj.value.mode === "projection" ? "assumption" : "sourced"} />}>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(["low", "mid", "high"] as const).map((k) => (
              <div key={k} className={`rounded-md border p-2 ${k === "mid" ? "border-brand bg-brand-soft" : "border-line"}`}>
                <div className="text-[11px] uppercase text-muted">{k}</div>
                <div className="tabular text-xl font-semibold">{num(proj.value[k])}</div>
                <div className="text-[11px] text-muted">{pct(proj.value.assumptions[k === "low" ? "showupLow" : k === "mid" ? "showupMid" : "showupHigh"] * 100, 0)} show-up</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-[13px]">
            <Row k="Confirmed external registrants" v={num(proj.value.confirmedNow)} />
            <Row k="Walk-in assumption" v={num(proj.value.assumptions.walkIns)} />
            <Row k="Goal in force" v={proj.value.goal != null ? num(proj.value.goal) : "n/a"} />
            {proj.value.mode === "actual" && proj.value.projectionError && (
              <>
                <Row k="Actual verified visitors" v={num(proj.value.actual)} strong />
                <Row k={`Mid projection made ${fmtDate(proj.value.projectionError.madeAsOf)}`} v={`${num(proj.value.projectionError.projectedMid)} (error ${pct(proj.value.projectionError.errorPct)})`} />
              </>
            )}
          </div>
          <Caveats items={proj.caveats} basis={proj.basis} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Registration pace" help="Cumulative registered external people by day vs a straight line to the registration goal at event start. The line is an assumption." right={<Badge kind="assumption">LINE = ASSUMPTION</Badge>}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={r.pace.value.series} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid stroke="#eef0f3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11 }} minTickGap={30} />
                <YAxis tick={{ fontSize: 11 }} width={44} />
                <Tooltip labelFormatter={(d) => fmtDate(String(d))} formatter={(v) => num(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="registered" name="Registered" stroke="#3b5bdb" dot={false} strokeWidth={2} />
                <Line type="stepAfter" dataKey="targetLine" name="Linear target line" stroke="#b7791f" dot={false} strokeDasharray="4 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
            <Mini label="Gap to line" value={r.pace.value.gapToLine == null ? "n/a" : `${r.pace.value.gapToLine > 0 ? "+" : ""}${num(r.pace.value.gapToLine)}`} />
            <Mini label="Avg per day, last 7 days" value={String(r.pace.value.avgDailyLast7)} />
            <Mini label="Needed per day to goal" value={r.pace.value.requiredDailyToGoal == null ? "n/a" : String(r.pace.value.requiredDailyToGoal)} />
            <Mini label="Days to event" value={num(r.pace.value.daysToEvent)} />
          </div>
          <Caveats items={r.pace.caveats} basis={r.pace.basis} />
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <Card title="Top flags" help="Scale / watch / stop per campaign from the thresholds in Settings. Hover a chip for the reason." right={<Link href="/campaigns" className="text-[12px] text-brand">All campaigns</Link>}>
            <ul className="space-y-2.5">
              {r.flags.value.flags.slice(0, 3).map((f) => (
                <li key={f.campaign_id} className="text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FlagChip level={f.level} title={f.reason} />
                      <span className="font-medium">{f.campaign_name}</span>
                    </div>
                    <Button variant="ghost" onClick={() => setDraft(taskFromFlag(f, data, asOf))}>
                      + Task
                    </Button>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted">{f.reason}</p>
                </li>
              ))}
            </ul>
            <Caveats items={r.flags.caveats} />
          </Card>

          <Card title="Data health" help="What the engine cleaned or excluded before counting. Shown so nobody double-counts.">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
              <Row k="Duplicate check-ins removed" v={num(health.value.duplicates.find((d) => d.table === "checkins")?.identicalCopies ?? 0)} />
              <Row k="Duplicate history rows" v={num(health.value.duplicates.find((d) => d.table === "registration_history")?.identicalCopies ?? 0)} />
              <Row k="Duplicate daily rows" v={num(health.value.duplicates.find((d) => d.table === "daily_marketing")?.identicalCopies ?? 0)} />
              <Row k="Conflicting duplicates" v={num(health.value.duplicates.reduce((a, d) => a + d.conflicting, 0))} warn={health.value.duplicates.some((d) => d.conflicting > 0)} />
              <Row k="Denied / pending scans" v={`${num(health.value.checkins.deniedScans)} / ${num(health.value.checkins.pendingScans)}`} />
              <Row k="Non-external admissions" v={num(health.value.checkins.nonExternalAdmissions)} />
              <Row k="Repeat admissions (same person)" v={num(health.value.checkins.repeatAdmissions)} />
              <Row k="Vendor credits (negative spend)" v={`${num(health.value.spend.negativeRows)} rows, ${inr(health.value.spend.negativeTotal)}`} />
            </div>
            {health.value.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-[12px] text-bad">
                {health.value.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-1.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`tabular ${strong ? "font-semibold text-ink" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ k, v, strong, warn }: { k: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{k}</span>
      <span className={`tabular ${strong ? "font-semibold" : ""} ${warn ? "font-semibold text-bad" : ""}`}>{v}</span>
    </div>
  );
}
