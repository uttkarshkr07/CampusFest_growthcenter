"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { campaignTable, dailyCampaign, flags, funnel, peopleDirectory, tasksView } from "@/lib/engine";
import { Button, Card, Caveats, Empty, FlagChip, PageHeader } from "@/components/ui";
import TaskDialog, { blankTask, type TaskDraft } from "@/components/TaskDialog";
import { taskFromFlag } from "@/components/flagTask";
import { useChartColors } from "@/lib/theme";
import { fmtDate, inr, num, pct, shortDay } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = { todo: "To do", doing: "In progress", blocked: "Blocked", done: "Done" };

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[18px] font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const campaignId = decodeURIComponent(id);
  const { data, asOf } = useStore();
  const c = useChartColors();
  const [draft, setDraft] = useState<TaskDraft | null>(null);

  const res = useMemo(() => {
    if (!data) return null;
    const table = campaignTable(data, asOf);
    const row = table.value.rows.find((r) => r.campaign_id === campaignId) ?? null;
    if (!row) return { row: null } as const;
    return {
      row,
      flag: flags(data, asOf).value.flags.find((f) => f.campaign_id === campaignId) ?? null,
      daily: dailyCampaign(data, campaignId, asOf),
      fun: funnel(data, asOf, { campaignId }),
      tasks: tasksView(data, asOf, { campaign_id: campaignId }).value.rows,
      people: peopleDirectory(data, asOf, { campaignId, pageSize: 20 }),
      sponsors: data.sponsor_activations.filter((s) => s.attendee_campaign_id === campaignId),
      caveats: table.caveats,
    };
  }, [data, asOf, campaignId]);

  if (!data || !res) return null;
  if (!res.row) {
    const exists = data.campaigns.some((x) => x.campaign_id === campaignId);
    return (
      <div className="space-y-4">
        <PageHeader title={campaignId} subtitle={<Link className="text-brand" href="/campaigns">back to Campaigns</Link>} />
        <Empty>{exists ? `Campaign ${campaignId} was not created yet on ${fmtDate(asOf)}. Pick a later as-of date.` : `There is no campaign with id ${campaignId} in this dataset.`}</Empty>
      </div>
    );
  }

  const { row, flag, daily, fun, tasks, people, sponsors } = res;
  const post = fun.value.phase === "post-event";
  const unit = post ? row.inrPerAttendee : row.inrPerConfirmed;
  const series = daily.value?.rows ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={row.campaign_name}
        subtitle={
          <>
            <span className="font-mono">{row.campaign_id}</span> · {row.channel ?? "no channel"} · owner {row.owner_name ?? "none"} · status {row.app_status} · <Link className="text-brand" href="/campaigns">back to Campaigns</Link>
          </>
        }
        right={
          <div className="flex items-center gap-2">
            {flag && <FlagChip level={flag.level} title={flag.reason} />}
            <Button onClick={() => setDraft(flag ? taskFromFlag(flag, data, asOf) : blankTask(asOf, { campaign_id: row.campaign_id, owner_id: data.campaigns.find((x) => x.campaign_id === row.campaign_id)?.owner_id ?? null }))}>
              <Plus className="h-4 w-4" /> Task
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Spend (net)" value={inr(row.spend)} hint={row.budget_inr != null ? `of ${inr(row.budget_inr)} budget${row.budgetUsedPct != null ? `, ${pct(row.budgetUsedPct)}` : ""}` : "no budget set"} />
        <Kpi label="Identified (first campaign)" value={num(row.identified)} />
        <Kpi label="Registered" value={num(row.registered)} />
        <Kpi label="Confirmed" value={num(row.confirmed)} />
        <Kpi label="Attended" value={post ? num(row.attended) : "not yet"} hint={post && row.showUpPct != null ? `show-up ${pct(row.showUpPct)}` : undefined} />
        <Kpi label={post ? "INR per actual attendee" : "INR per confirmed (pre-event proxy)"} value={unit != null ? inr(unit) : "n/a"} />
      </div>
      {flag && (
        <p className="rounded-md border border-line bg-panel px-3 py-2 text-[13px]">
          <span className="font-semibold capitalize">{flag.level}:</span> <span className="text-ink-2">{flag.reason}</span>
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="Daily activity" help="Spend (bars, right axis) and clicks, landing sessions and registration starts (lines, left axis), up to the as-of date. These are anonymous events, not people.">
          {series.length === 0 ? (
            <Empty>No daily marketing rows for this campaign up to {fmtDate(asOf)}.</Empty>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: c.axis }} minTickGap={36} stroke={c.grid} />
                  <YAxis yAxisId="n" tick={{ fontSize: 11, fill: c.axis }} width={44} stroke={c.grid} tickFormatter={(x) => num(Number(x))} />
                  <YAxis yAxisId="inr" orientation="right" tick={{ fontSize: 11, fill: c.axis }} width={56} stroke={c.grid} tickFormatter={(x) => inr(Number(x), { compact: true })} />
                  <Tooltip labelFormatter={(d) => fmtDate(String(d))} formatter={(val, name) => [name === "Spend" ? inr(Number(val)) : num(Number(val)), name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="inr" dataKey="spend" name="Spend" fill={c.neutral} fillOpacity={0.45} isAnimationActive={false} />
                  <Line yAxisId="n" dataKey="clicks" name="Clicks" stroke={c.brand2} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line yAxisId="n" dataKey="sessions" name="Landing sessions" stroke={c.brand} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="n" dataKey="registrationStarts" name="Registration starts" stroke={c.good} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {daily.value && (
            <p className="mt-2 text-[12px] text-muted">
              Totals to date: spend {inr(daily.value.totals.spend)}, clicks {num(daily.value.totals.clicks)}, sessions {num(daily.value.totals.sessions)}, registration starts {num(daily.value.totals.registrationStarts)}.
            </p>
          )}
        </Card>

        <Card title="Funnel for this campaign" help="Identified = people whose first campaign is this one. Later stages = people who registered through it. Walk-ins have no campaign.">
          <ul className="space-y-2">
            {fun.value.stages.map((s, i) => {
              const top = fun.value.stages[0].count || 1;
              const prev = i > 0 ? fun.value.stages[i - 1].count : null;
              return (
                <li key={s.key} title={s.definition}>
                  <div className="flex justify-between text-[12px]">
                    <span>{s.label}</span>
                    <span className="font-semibold">
                      {num(s.count)}
                      {prev ? <span className="ml-1 font-normal text-muted">({pct((s.count / prev) * 100)})</span> : null}
                    </span>
                  </div>
                  <div className="mt-0.5 h-2 rounded bg-subtle-2">
                    <div className="h-2 rounded bg-brand" style={{ width: `${Math.min(100, (s.count / top) * 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {fun.value.biggestLeak && fun.value.biggestLeak.lost > 0 && (
            <p className="mt-3 text-[12px] text-ink-2">
              Biggest leak: {fun.value.biggestLeak.from} to {fun.value.biggestLeak.to}, {num(fun.value.biggestLeak.lost)} people lost ({pct(fun.value.biggestLeak.conversion)} carried on).
            </p>
          )}
          {post && fun.value.confirmedNoShows != null && <p className="mt-1 text-[12px] text-ink-2">{num(fun.value.confirmedNoShows)} confirmed registrants did not show up.</p>}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Tasks for this campaign (${tasks.length})`} right={<Link className="text-[12px] text-brand" href="/tasks">All tasks</Link>}>
          {tasks.length === 0 ? (
            <Empty>No tasks are linked to this campaign.</Empty>
          ) : (
            <ul className="divide-y divide-line/60 text-[13px]">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-2 py-1.5">
                  <Link className="font-medium hover:text-brand" href={`/tasks?focus=${t.id}`}>
                    {t.title}
                  </Link>
                  <span className={`whitespace-nowrap text-[12px] ${t.overdue ? "font-semibold text-bad" : "text-muted"}`}>
                    {t.owner_name ?? "unassigned"} · {STATUS_LABEL[t.status] ?? t.status}
                    {t.overdue ? " · overdue" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Sponsor link">
          {sponsors.length === 0 ? (
            <Empty>No sponsor activation is linked to this campaign.</Empty>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {sponsors.map((s) => (
                <li key={s.activation_id} className="rounded-md border border-line px-2.5 py-2">
                  <div className="font-medium">{s.brand_name}</div>
                  {s.opportunity_name && <div className="text-[12px] text-muted">{s.opportunity_name}</div>}
                  {s.activation_note && <div className="mt-0.5 text-[12px]">{s.activation_note}</div>}
                  <div className="text-[11px] text-muted">linked {fmtDate(s.linked_at)}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-warn">The link is an association. The data does not show that the sponsor added any attendees.</p>
        </Card>
      </div>

      <Card
        title={`People who registered through this campaign (${num(people.value.total)})`}
        right={
          people.value.total > people.value.rows.length ? (
            <Link className="text-[12px] text-brand" href={`/people?campaign=${encodeURIComponent(row.campaign_id)}`}>
              See all {num(people.value.total)} on People
            </Link>
          ) : undefined
        }
      >
        {people.value.rows.length === 0 ? (
          <Empty>Nobody had registered through this campaign by {fmtDate(asOf)}.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-line text-left text-[12px] text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">ID</th>
                  <th className="px-2 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium">Latest status</th>
                  <th className="px-2 py-1.5 font-medium">Attended</th>
                  <th className="px-2 py-1.5 font-medium">Asked a question</th>
                </tr>
              </thead>
              <tbody>
                {people.value.rows.map((r) => (
                  <tr key={r.person_id} className="border-b border-line/60">
                    <td className="px-2 py-1.5 font-mono text-[12px]">
                      <Link className="text-brand hover:underline" href={`/people/${encodeURIComponent(r.person_id)}`}>
                        {r.person_id}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">{r.person_name}</td>
                    <td className="px-2 py-1.5">{r.latest_status ?? <span className="text-muted">none</span>}</td>
                    <td className="px-2 py-1.5">{r.attended ? <span className="font-medium text-good">yes</span> : <span className="text-muted">no</span>}</td>
                    <td className="px-2 py-1.5">{r.engaged ? "yes" : <span className="text-muted">no</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Caveats items={[...new Set([...res.caveats, ...fun.caveats, ...(daily.caveats ?? [])])]} basis={[...new Set([...fun.basis, ...daily.basis])]} />
      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
