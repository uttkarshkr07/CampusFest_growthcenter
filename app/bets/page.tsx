"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/store";
import { canEdit, whoCanEdit } from "@/lib/auth/permissions";
import { VERDICT_LABEL, betTracker, type BetCard, type Breakdown, type KpiResult, type Threshold, type TrackerValue, type Verdict } from "@/lib/engine";
import ChampionshipBoard from "@/components/ChampionshipBoard";
import TaskDialog, { blankTask, type TaskDraft } from "@/components/TaskDialog";
import { QueryParams, useSpotlight } from "@/components/deeplink";
import { Badge, Button, Card, Caveats, PageHeader, inputCls } from "@/components/ui";
import { fmtDate, inr, num } from "@/lib/format";

const CHIP: Record<Verdict, string> = {
  scale: "bg-good-soft text-good border-green-200",
  change: "bg-warn-soft text-warn border-amber-200",
  stop: "bg-bad-soft text-bad border-red-200",
  too_early: "bg-slate-100 text-slate-600 border-slate-200",
  not_enough_data: "bg-slate-100 text-slate-600 border-slate-200",
  not_applicable: "bg-white text-muted border-line",
  tracking: "bg-brand-soft text-brand border-blue-200",
};
const VerdictChip = ({ v }: { v: Verdict }) => <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${CHIP[v]}`}>{VERDICT_LABEL[v]}</span>;

/** who a task from this check goes to unless changed */
type Make = (card: BetCard, k: KpiResult, row?: Breakdown["rows"][number]) => void;

export default function BetsPage() {
  const { data, asOf } = useStore();
  const res = useMemo(() => (data ? betTracker(data, asOf) : null), [data, asOf]);
  const mayEdit = canEdit(useAuth((s) => s.me), "bet_thresholds");
  const [tab, setTab] = useState<"bets" | "championship">("bets");
  const [focus, setFocus] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  useSpotlight(focus && tab === "bets" ? `bet-${focus}` : null);
  if (!data || !res) return null;
  const v = res.value;

  const make: Make = (card, k, row) => {
    const t = k.threshold;
    const rule = [`${k.id} ${k.name}`, t && t.scaleAt != null ? `${t.direction} is better; scale at ${t.scaleAt}, stop at ${t.stopAt}, minimum sample ${t.minSample ?? "none"}` : "no numeric threshold", t?.checkOn ? `check on ${t.checkOn}` : ""].filter(Boolean).join("; ");
    const verdict = row?.verdict ?? k.verdict;
    const action = row?.verdict === "change" || row?.verdict === "stop" || row?.verdict === "scale" ? t?.actions[row.verdict] || null : k.action;
    const member = data.team.find((m) => m.team === card.ownerTeam);
    setDraft(
      blankTask(asOf, {
        title: `${row ? row.cells[0] : card.name}: ${VERDICT_LABEL[verdict]} on ${k.name.toLowerCase()}`,
        description: action ?? `Follow up on ${k.name.toLowerCase()}.`,
        owner_id: row?.ownerId && data.team.some((m) => m.owner_id === row.ownerId) ? row.ownerId : (member?.owner_id ?? null),
        priority: verdict === "stop" ? "high" : verdict === "change" ? "medium" : "low",
        origin: "rule",
        origin_ref: {
          rule,
          reason: `${card.name}: ${VERDICT_LABEL[verdict]}. ${row ? `${row.cells.join(", ")}.` : `Value ${k.display}, data to ${k.judgedOn}.`}`,
          evidence: [...(card.simulationNote ? [card.simulationNote] : []), ...k.numbers],
          asOf,
        },
      }),
    );
  };

  return (
    <div className="space-y-4">
      <QueryParams
        onParams={(p) => {
          setFocus(p.get("focus"));
          if (p.get("tab") === "championship") setTab("championship");
          else if (p.get("focus")) setTab("bets");
        }}
      />
      <PageHeader title="Bet tracker" subtitle={`Each bet's checks, computed from the records up to the end of ${fmtDate(asOf)}. Thresholds are assumptions you can edit.`} />
      <div className="flex gap-1 border-b border-line" role="tablist">
        {(["bets", "championship"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium ${tab === t ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
            {t === "bets" ? "Bets" : "Championship"}
          </button>
        ))}
      </div>

      {tab === "championship" ? (
        <ChampionshipBoard />
      ) : (
        <>
          {!v.hasBetData && <p className="rounded-md border border-line bg-white px-3 py-2 text-[13px]">The original 2025 data has no squads, payments, passes, seats, waitlist offers, contingents or bet records. Only the whole-plan checks, and two proxies, can be answered. Switch to the simulated run to see the bets.</p>}
          {v.hasBetData && !mayEdit && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">Thresholds are view only for you. {whoCanEdit("bet_thresholds")}</p>}
          {focus && ![...v.bets, v.plan].some((b) => b.bet_id === focus) && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">There is no bet {focus}.</p>}
          <Spend s={v.spend} hasBetData={v.hasBetData} />
          {[v.plan, ...v.bets].map((card) => (
            <Bet key={card.bet_id} card={card} mayEdit={mayEdit} make={make} />
          ))}
          <Caveats items={res.caveats} basis={res.basis} />
        </>
      )}
      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function Spend({ s, hasBetData }: { s: TrackerValue["spend"]; hasBetData: boolean }) {
  return (
    <p className={`rounded-md px-3 py-2 text-[13px] ${s.over ? "bg-bad-soft text-bad" : "border border-line bg-white"}`}>
      Media spend to date {inr(s.media)}
      {hasBetData ? ` plus bet spend ${inr(s.bets)} = ${inr(s.total)}, ${s.over ? "OVER" : "within"} the cap of ${inr(s.cap)}.` : ". No bet spend exists in this dataset."}
    </p>
  );
}

function Bet({ card, mayEdit, make }: { card: BetCard; mayEdit: boolean; make: Make }) {
  return (
    <div id={`bet-${card.bet_id}`} className="rounded-lg">
      <Card
        title={
          <>
            {card.bet_id !== "PLAN" && <span className="text-muted">{card.bet_id}</span>} {card.name}
          </>
        }
        right={
          card.headline ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              Lead check {card.headline.kpiId} <VerdictChip v={card.headline.verdict} />
            </span>
          ) : null
        }
      >
        {card.simulationNote && <p className="mb-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-[12px] font-semibold text-warn">{card.simulationNote}</p>}
        {card.budget != null && (
          <p className="mb-2 text-[12px] text-muted">
            Spent {inr(card.spent)} of {inr(card.budget)} budget{card.overBudget && <span className="ml-1 font-semibold text-bad">OVER BUDGET</span>}
            {card.plannedBase != null && ` · planned increment ${num(card.plannedBase)} base, ${num(card.plannedStretch)} stretch (modelled)`}
            {card.spendPerModelled != null && ` · ${inr(card.spendPerModelled)} per modelled attendee (incrementality is not observed)`}
            {card.ownerTeam && ` · owner: ${card.ownerTeam}`}
          </p>
        )}
        <ul className="divide-y divide-line">
          {card.kpis.map((k) => (
            <Kpi key={k.id} card={card} k={k} mayEdit={mayEdit} make={make} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

const unitOf = (k: KpiResult) => (k.unit === "pct" ? "%" : "");

function thresholdLine(k: KpiResult, t: Threshold): string {
  if (t.scaleAt == null || t.stopAt == null) return [t.minSample != null ? `minimum sample ${num(t.minSample)}` : "", t.checkOn ? `check on ${fmtDate(t.checkOn)}` : ""].filter(Boolean).join(" · ");
  const u = unitOf(k);
  const [scale, stop] = t.direction === "lower" ? [`${t.scaleAt}${u} or less`, `above ${t.stopAt}${u}`] : [`${t.scaleAt}${u} or more`, `under ${t.stopAt}${u}`];
  return [`Scale: ${scale}`, `Stop: ${stop}`, "Change: in between", t.minSample != null ? `minimum ${num(t.minSample)} ${k.sampleLabel}` : "", t.checkOn ? `check on ${fmtDate(t.checkOn)}` : ""].filter(Boolean).join(" · ");
}

function Kpi({ card, k, mayEdit, make }: { card: BetCard; k: KpiResult; mayEdit: boolean; make: Make }) {
  const [editing, setEditing] = useState(false);
  const t = k.threshold;
  const applies = k.verdict !== "not_applicable";
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip v={k.verdict} />
        <span className="text-[13px] font-medium">
          <span className="text-muted">{k.id}</span> {k.name}
        </span>
        <span className="text-[11px] text-muted">{k.timing}</span>
        {k.proxy && <Badge kind="neutral">PROXY</Badge>}
        {applies && <span className="tabular ml-auto text-[15px] font-semibold">{k.display}</span>}
      </div>
      {applies && (k.latest || k.sample != null) && (
        <div className="mt-0.5 text-right text-[11px] text-muted">
          {k.latest && `Judged on data to ${fmtDate(k.judgedOn)}; latest value ${k.latest}. `}
          {k.sample != null && k.sampleLabel && `Sample: ${num(k.sample)} ${k.sampleLabel}.`}
        </div>
      )}
      {k.note && <div className="mt-1 text-[12px] text-muted">{k.note.replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d))}</div>}
      {k.action && (
        <div className="mt-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-[12px]">
          <span className="font-semibold">Action:</span> {k.action}
        </div>
      )}
      {k.warnings.map((w) => (
        <div key={w} className="mt-1 text-[12px] text-warn">
          {w}
        </div>
      ))}
      {t && applies && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Badge kind="assumption" />
          <span>{thresholdLine(k, t)}</span>
          {t.rowId != null && k.id !== "K18" && (
            <button className="text-brand underline disabled:text-muted disabled:no-underline" disabled={!mayEdit} title={mayEdit ? undefined : whoCanEdit("bet_thresholds")} onClick={() => setEditing(!editing)}>
              {editing ? "Close" : "Edit"}
            </button>
          )}
        </div>
      )}
      {editing && t && <ThresholdForm key={`${t.rowId}-${t.scaleAt}-${t.stopAt}-${t.minSample}-${t.checkOn}`} t={t} onDone={() => setEditing(false)} />}
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <details className="min-w-0 flex-1 text-[12px]">
          <summary className="cursor-pointer select-none text-muted">Numbers behind it</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {k.numbers.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {k.breakdown && <Table b={k.breakdown} onTask={k.id === "K04" ? (row) => make(card, k, row) : undefined} />}
          <p className="mt-1.5 text-muted">How it is calculated: {k.formula}</p>
        </details>
        {applies && (
          <Button variant="ghost" onClick={() => make(card, k)}>
            + Task
          </Button>
        )}
      </div>
    </li>
  );
}

const SHOWN_ROWS = 15;

function Table({ b, onTask }: { b: Breakdown; onTask?: (row: Breakdown["rows"][number]) => void }) {
  const [all, setAll] = useState(false);
  if (!b.rows.length) return null;
  return (
    <div className="mt-2 overflow-x-auto">
      <div className="font-medium">{b.title}</div>
      <table className="w-full">
        <thead className="border-b border-line text-muted">
          <tr>
            {b.columns.map((c) => (
              <th key={c} className="px-1.5 py-1 text-left font-medium">
                {c}
              </th>
            ))}
            {onTask && <th />}
          </tr>
        </thead>
        <tbody>
          {(all ? b.rows : b.rows.slice(0, SHOWN_ROWS)).map((r) => (
            <tr key={r.id} className="border-b border-line/60 align-top">
              {r.cells.map((c, i) => (
                <td key={i} className="px-1.5 py-1">
                  {c}
                </td>
              ))}
              {onTask && (
                <td className="whitespace-nowrap px-1.5 py-1 text-right">
                  {r.verdict && <VerdictChip v={r.verdict} />}{" "}
                  <button className="text-brand underline" onClick={() => onTask(r)}>
                    + Task
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {b.rows.length > SHOWN_ROWS && (
        <button className="mt-1 text-brand underline" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${b.rows.length}`}
        </button>
      )}
    </div>
  );
}

function ThresholdForm({ t, onDone }: { t: Threshold; onDone: () => void }) {
  const { updateThreshold, saving } = useStore();
  const show = (x: number | null) => (x == null ? "" : String(x));
  const [f, setF] = useState({ scale: show(t.scaleAt), stop: show(t.stopAt), min: show(t.minSample), checkOn: t.checkOn ?? "" });
  const numeric = t.scaleAt != null && t.stopAt != null;
  const valid = (x: string) => x.trim() !== "" && Number.isFinite(Number(x)) && Number(x) >= 0;
  const ordered = !numeric || (t.direction === "lower" ? Number(f.scale) <= Number(f.stop) : Number(f.scale) >= Number(f.stop));
  const ok = (!numeric || (valid(f.scale) && valid(f.stop))) && (f.min === "" || valid(f.min)) && ordered;
  async function save() {
    const saved = await updateThreshold(t.rowId!, {
      ...(numeric ? { scale_at: Number(f.scale), stop_at: Number(f.stop) } : {}),
      ...(f.min !== "" ? { min_sample: Number(f.min) } : {}),
      check_on: f.checkOn || null,
    });
    if (saved) onDone();
  }
  const input = (label: string, key: keyof typeof f, type = "text") => (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-muted">{label}</span>
      <input type={type} className={`${inputCls} ${type === "date" ? "w-36" : "w-24"}`} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-line p-2.5">
      {numeric && input("Scale at", "scale")}
      {numeric && input("Stop at", "stop")}
      {input("Minimum sample", "min")}
      {input("Check on", "checkOn", "date")}
      <Button variant="primary" onClick={save} disabled={!ok || saving}>
        Save
      </Button>
      {!ordered && <span className="text-[12px] text-bad">{t.direction === "lower" ? "Scale at must not be above stop at." : "Scale at must not be below stop at."}</span>}
    </div>
  );
}
