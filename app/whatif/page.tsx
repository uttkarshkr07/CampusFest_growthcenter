"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { campaignTable, viewAsOf, whatIf, type Move } from "@/lib/engine";
import { Badge, Button, Card, Caveats, Empty, Field, PageHeader, inputCls } from "@/components/ui";
import { inr, num } from "@/lib/format";

interface MoveInput {
  from: string;
  to: string;
  inr: string;
}

const blank: MoveInput = { from: "", to: "", inr: "" };

export default function WhatIfPage() {
  const { data, asOf } = useStore();
  const [moves, setMoves] = useState<MoveInput[]>([{ ...blank }]);
  const [cut, setCut] = useState("");
  const [strategy, setStrategy] = useState<"proportional" | "costliest_first">("proportional");
  const [showUp, setShowUp] = useState("");
  const [capacity, setCapacity] = useState("");

  const res = useMemo(() => {
    if (!data) return null;
    const view = viewAsOf(data, asOf);
    const campaigns = campaignTable(view, asOf).value.rows;
    const used: Move[] = moves.filter((m) => Number(m.inr) > 0 && (m.from || m.to)).map((m) => ({ from: m.from || undefined, to: m.to || undefined, inr: Number(m.inr) }));
    const nothing = !used.length && !(Number(cut) > 0) && showUp === "";
    const out = nothing
      ? null
      : whatIf(view, {
          asOf,
          moves: used,
          budgetChangePct: Number(cut) > 0 ? -Math.min(100, Number(cut)) : undefined,
          cutStrategy: strategy,
          confirmedShowUpPct: showUp === "" ? undefined : Number(showUp),
          capacityAttendees: Number(capacity) > 0 ? Math.round(Number(capacity)) : undefined,
        });
    return { campaigns, out };
  }, [data, asOf, moves, cut, strategy, showUp, capacity]);
  if (!data || !res) return null;

  const options = res.campaigns.map((c) => (
    <option key={c.campaign_id} value={c.campaign_id}>
      {c.campaign_id} {c.campaign_name} ({inr(c.spend)})
    </option>
  ));
  const setMove = (i: number, patch: Partial<MoveInput>) => setMoves(moves.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const v = res.out?.value ?? null;
  const signed = (n: number) => `${n > 0 ? "+" : ""}${num(n)}`;

  return (
    <div className="space-y-4">
      <PageHeader title="What-if" subtitle="Budget and show-up scenarios on the current data. Results are arithmetic on assumptions, not forecasts of cause." right={<Badge kind="assumption" />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scenario">
          <div className="space-y-3">
            {moves.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_110px_auto] items-end gap-2">
                <Field label="Take from">
                  <select className={inputCls} value={m.from} onChange={(e) => setMove(i, { from: e.target.value })}>
                    <option value="">(new money)</option>
                    {options}
                  </select>
                </Field>
                <Field label="Give to">
                  <select className={inputCls} value={m.to} onChange={(e) => setMove(i, { to: e.target.value })}>
                    <option value="">(save it)</option>
                    {options}
                  </select>
                </Field>
                <Field label="INR">
                  <input className={inputCls} type="number" min={0} value={m.inr} onChange={(e) => setMove(i, { inr: e.target.value })} />
                </Field>
                <button className="pb-2 text-muted hover:text-bad" onClick={() => setMoves(moves.length > 1 ? moves.filter((_, j) => j !== i) : [{ ...blank }])} aria-label="Remove move">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button onClick={() => setMoves([...moves, { ...blank }])}>
              <Plus className="h-4 w-4" /> Add a move
            </Button>
            <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
              <Field label="Cut the whole budget by (%)">
                <input className={inputCls} type="number" min={0} max={100} value={cut} onChange={(e) => setCut(e.target.value)} />
              </Field>
              <Field label="How to apply the cut">
                <select className={inputCls} value={strategy} onChange={(e) => setStrategy(e.target.value as typeof strategy)}>
                  <option value="proportional">In proportion to spend</option>
                  <option value="costliest_first">Costliest campaigns first</option>
                </select>
              </Field>
              <Field label="Confirmed people who attend (%)">
                <input className={inputCls} type="number" min={0} max={100} value={showUp} onChange={(e) => setShowUp(e.target.value)} />
              </Field>
              <Field label="Capacity, distinct attendees (optional)">
                <input className={inputCls} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Result">
          {!res.out ? (
            <Empty>Enter a budget move, a cut or a show-up rate.</Empty>
          ) : !v ? (
            <div className="rounded-md bg-warn-soft p-3 text-[13px] text-warn">{res.out.caveats[0]}</div>
          ) : (
            <div className="space-y-3 text-[13px]">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: `Baseline (${v.baseline.kind})`, value: num(v.baseline.attendees), sub: "" },
                  { label: "Cautious / low", value: v.low.attendees != null ? num(v.low.attendees) : signed(v.low.attendeeChange), sub: v.low.attendees != null ? signed(v.low.attendeeChange) : "change in attendees" },
                  { label: "Optimistic / high", value: v.high.attendees != null ? num(v.high.attendees) : signed(v.high.attendeeChange), sub: v.high.attendees != null ? signed(v.high.attendeeChange) : "change in attendees" },
                ].map((x) => (
                  <div key={x.label} className="rounded-md border border-line p-2">
                    <div className="text-[11px] text-muted">{x.label}</div>
                    <div className="tabular text-xl font-semibold">{x.value}</div>
                    <div className="tabular text-[12px] text-muted">{x.sub}</div>
                  </div>
                ))}
              </div>
              <div className="text-muted">
                Net budget change: {inr(v.netBudgetChangeInr)}
                {v.budget.inForce != null && ` · budget ${inr(v.budget.inForce)}, spent ${inr(v.budget.spentSoFar)}, unspent ${inr(v.budget.unspent)}`}
              </div>
              {v.low.attendees == null && <div className="text-[12px] text-warn">Before the event only unspent money can change, so this shows the change, not a new total.</div>}
              {v.lines.length > 0 && (
                <table className="w-full text-[12px]">
                  <thead className="border-b border-line text-left text-muted">
                    <tr>
                      <th className="py-1 font-medium">Campaign</th>
                      <th className="py-1 font-medium">Change</th>
                      <th className="py-1 text-right font-medium">Average cost</th>
                      <th className="py-1 text-right font-medium">Effect ({v.lines[0].effectUnit}s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.lines.map((l) => (
                      <tr key={`${l.campaign_id}-${l.direction}`} className="border-b border-line/60">
                        <td className="py-1">{l.campaign_name}</td>
                        <td className="py-1">{l.direction} {inr(l.inr)}</td>
                        <td className="tabular py-1 text-right">{inr(l.averageUnitCost)}</td>
                        <td className="tabular py-1 text-right">
                          {signed(l.effectCautious)}
                          {l.effectOptimistic !== l.effectCautious ? ` to ${signed(l.effectOptimistic)}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <ul className="list-disc space-y-1 rounded-md bg-warn-soft py-2 pl-6 pr-3 text-[12px] text-warn">
                {v.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {res.out && <Caveats items={res.out.caveats} basis={res.out.basis} />}
        </Card>
      </div>
    </div>
  );
}
