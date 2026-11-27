"use client";

import Link from "next/link";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, X } from "lucide-react";
import type { forecastHistory, landingForecast, liveGate } from "@/lib/engine";
import { Badge, Caveats } from "@/components/ui";
import { useChartColors } from "@/lib/theme";
import { fmtDate, num, pct, shortDay } from "@/lib/format";

type LF = ReturnType<typeof landingForecast>;
type Gate = ReturnType<typeof liveGate>;
type Hist = ReturnType<typeof forecastHistory>;

function Section({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="@container rounded-xl border border-line bg-panel">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {badge}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) => (
  <div className="rounded-lg bg-subtle px-3 py-2">
    <div className="text-[11px] text-muted">{label}</div>
    <div className={`tabular text-[17px] font-semibold ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</div>
    {sub && <div className="text-[11px] text-muted">{sub}</div>}
  </div>
);

export function ForecastHero({ lf, k20, pending }: { lf: LF; k20: string | null; pending: number }) {
  const v = lf.value;
  const f = v.forecast;
  const c = useChartColors();
  const short = v.gap != null && v.gap < 0;
  const paceVsNeeded = v.neededPerDay != null && v.neededPerDay > 0 ? Math.min(100, (f.pace.d14 / v.neededPerDay) * 100) : 100;
  return (
    <Section title="Will we hit the goal?" badge={<Badge kind="assumption">FORECAST = ASSUMPTION</Badge>}>
      <div className="grid gap-4 @2xl:grid-cols-[230px_1fr]">
        <div className="space-y-3">
          <div>
            <div className="text-[12px] text-muted">Expected actual attendees</div>
            <div className="tabular text-4xl font-bold tracking-tight">{num(f.mid)}</div>
            <div className="tabular text-[12px] text-muted">
              range {num(f.low)} to {num(f.high)}
            </div>
          </div>
          {v.goal != null && (
            <div className={`rounded-lg px-3 py-2 text-[13px] ${short ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>
              <b>{short ? `${num(-v.gap!)} short` : `${num(v.gap!)} above`}</b> of the {num(v.goal)} goal
            </div>
          )}
          {v.neededConfirmed != null && (
            <div className="space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="text-muted">Confirmed now / needed</span>
                <span className="tabular font-medium">
                  {num(f.confirmed)} / {num(v.neededConfirmed)}
                </span>
              </div>
              {v.neededPerDay != null && (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Recent pace vs needed, per day</span>
                    <span className="tabular font-medium">
                      {f.pace.d14} / {v.neededPerDay}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-subtle-2" role="img" aria-label={`Recent pace is ${Math.round(paceVsNeeded)}% of the pace needed`}>
                    <div className={`h-full ${paceVsNeeded >= 100 ? "bg-good" : "bg-warn"}`} style={{ width: `${paceVsNeeded}%` }} />
                  </div>
                </>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted">Banked if nobody else confirms</span>
                <span className="tabular font-medium">{num(f.banked)}</span>
              </div>
              {pending > 0 && (
                <div className="flex justify-between gap-2" title="Signed up but not confirmed. The forecast leaves them out, so where people confirm late (for example at a payment deadline) it reads low until then.">
                  <span className="text-muted">Signed up, not confirmed (not counted)</span>
                  <span className="tabular font-medium">{num(pending)}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted">Days left for sign-ups</span>
                <span className="tabular font-medium">{f.daysLeft}</span>
              </div>
            </div>
          )}
          {k20 && <p className="rounded-lg border border-line px-3 py-2 text-[12px] text-muted">Cross-check, bet model (K20): <b className="text-ink">{k20}</b></p>}
        </div>
        <div>
          <div className="mb-1 text-[12px] text-muted">Confirmed people: so far, and the forecast to Day 1</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={v.chart} margin={{ left: 0, right: 10, top: 6, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11 }} minTickGap={36} stroke={c.grid} />
                <YAxis tick={{ fontSize: 11 }} width={48} stroke={c.grid} tickFormatter={(x) => num(Number(x))} />
                <Tooltip labelFormatter={(d) => fmtDate(String(d))} formatter={(val, name) => (Array.isArray(val) ? [`${num(Number(val[0]))} to ${num(Number(val[1]))}`, name] : [num(Number(val)), name])} />
                <Legend verticalAlign="top" height={44} wrapperStyle={{ fontSize: 12, lineHeight: "18px" }} />
                <Area dataKey={(d: { coneLow: number | null; coneHigh: number | null }) => (d.coneLow == null ? null : [d.coneLow, d.coneHigh])} name="Forecast range" stroke="none" fill={c.band} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
                <Line dataKey="registered" name="Registered" stroke={c.brand2} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="confirmed" name="Confirmed" stroke={c.brand} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="coneMid" name="Forecast (mid)" stroke={c.brand} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
                <Line dataKey="needed" name="Confirmed needed for the goal" type="stepAfter" stroke={c.goal} strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
                {v.targetChanges.slice(1).map((t) => (
                  <ReferenceLine key={t.day + t.version} x={t.day} stroke={c.goal} strokeOpacity={0.5} label={{ value: t.version.length > 22 ? `${t.version.slice(0, 21)}...` : t.version, position: "insideTopLeft", fontSize: 10, fill: c.axis }} />
                ))}
                <ReferenceLine x={f.day} stroke={c.axis} strokeDasharray="3 3" label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: c.axis }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <Caveats items={lf.caveats} basis={lf.basis} />
    </Section>
  );
}

export function LiveGate({ gate, goal }: { gate: Gate; goal: number | null }) {
  const g = gate.value;
  const c = useChartColors();
  return (
    <Section title="The fest is on: the gate" badge={<Badge kind="sourced">FROM CHECK-INS</Badge>}>
      <div className="grid gap-4 @2xl:grid-cols-[230px_1fr]">
        <div className="space-y-3">
          <div>
            <div className="text-[12px] text-muted">Actual attendees so far</div>
            <div className="tabular text-4xl font-bold tracking-tight">{num(g.attendees)}</div>
            {goal != null && <div className="text-[12px] text-muted">{pct((g.attendees / goal) * 100)} of the {num(goal)} goal</div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Tile label={`Day 1, ${shortDay(g.day1.day)}`} value={num(g.day1.people)} />
            <Tile label={`Day 2, ${shortDay(g.day2.day)}`} value={num(g.day2.people)} sub={g.day2.people ? `${num(g.day2.firstTimers)} first-timers` : undefined} />
            <Tile label="Walk-ins" value={num(g.walkIns)} />
            <Tile label="Stuck at the gate" value={num(g.unresolvedGate)} tone={g.unresolvedGate ? "bad" : undefined} sub={`${num(g.deniedScans)} denied scans`} />
          </div>
          {g.unresolvedGate > 0 && (
            <Link href="/actions?cohort=gate_failed_not_admitted" className="block text-[12px] font-medium text-brand">
              See who is stuck at the gate
            </Link>
          )}
        </div>
        <div>
          <div className="mb-1 text-[12px] text-muted">Admission scans per hour, {fmtDate(g.hourlyDay)}</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={g.hourly} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke={c.grid} />
                <YAxis tick={{ fontSize: 11 }} width={44} stroke={c.grid} />
                <Tooltip formatter={(val) => [num(Number(val)), "Admission scans"]} />
                <Bar dataKey="count" name="Admission scans" fill={c.brand} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <Caveats items={gate.caveats} basis={gate.basis} />
    </Section>
  );
}

export function FinalResult({ gate, hist, goal, targetVersion }: { gate: Gate; hist: Hist; goal: number | null; targetVersion: string | null }) {
  const g = gate.value;
  const h = hist.value;
  const hit = goal != null && g.attendees >= goal;
  return (
    <Section title="Final result" badge={<Badge kind="sourced">ACTUAL</Badge>}>
      <div className="grid gap-4 @2xl:grid-cols-[230px_1fr]">
        <div className="space-y-3">
          <div>
            <div className="text-[12px] text-muted">People who actually attended</div>
            <div className="tabular text-4xl font-bold tracking-tight">{num(g.attendees)}</div>
          </div>
          {goal != null && (
            <div className={`rounded-lg px-3 py-2 text-[13px] ${hit ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
              <b>{pct((g.attendees / goal) * 100)}</b> of the {num(goal)} goal, {hit ? `${num(g.attendees - goal)} above` : `${num(goal - g.attendees)} short`}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Day 1" value={num(g.day1.people)} />
            <Tile label="Day 2" value={num(g.day2.people)} sub={`${num(g.day2.firstTimers)} first-timers`} />
            <Tile label="Both days" value={num(g.bothDays)} />
            <Tile label="Walk-ins" value={num(g.walkIns)} />
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] text-muted">How good was the forecast? What it said before the fest, against the actual {num(h.actual)}</div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase text-muted">
                <th className="py-1.5 font-medium">When</th>
                <th className="py-1.5 text-right font-medium">Range</th>
                <th className="py-1.5 text-right font-medium">Mid</th>
                <th className="py-1.5 text-right font-medium">Error</th>
                <th className="py-1.5 text-right font-medium">Actual in range</th>
              </tr>
            </thead>
            <tbody>
              {h.checkpoints.map((x) => (
                <tr key={x.label} className="border-b border-line/60">
                  <td className="py-1.5">
                    <b>{x.label}</b> <span className="text-muted">{shortDay(x.day)}</span>
                  </td>
                  <td className="tabular py-1.5 text-right">
                    {num(x.low)} to {num(x.high)}
                  </td>
                  <td className="tabular py-1.5 text-right">{num(x.mid)}</td>
                  <td className={`tabular py-1.5 text-right ${Math.abs(x.errorPct ?? 0) <= 10 ? "text-good" : "text-bad"}`}>{x.errorPct != null ? `${x.errorPct > 0 ? "+" : ""}${pct(x.errorPct)}` : "n/a"}</td>
                  <td className="py-1.5 text-right">{x.inRange ? <Check className="ml-auto h-4 w-4 text-good" aria-label="yes" /> : <X className="ml-auto h-4 w-4 text-bad" aria-label="no" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted">The same method as the forecast before the fest, rerun with only what was known on each day. Far off early and close late usually means sign-ups arrived in a late burst, which a straight-line pace cannot see.</p>
        </div>
      </div>
      <Caveats items={[...gate.caveats, ...hist.caveats]} basis={[...hist.basis]} />
    </Section>
  );
}

export { Section, Tile };
