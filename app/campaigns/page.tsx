"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/store";
import { canEdit, whoCanEdit } from "@/lib/auth/permissions";
import { campaignTable, flags, toIstIso, type CampaignMetrics } from "@/lib/engine";
import { Badge, Button, Card, Caveats, Field, FlagChip, Modal, PageHeader, Tip, inputCls } from "@/components/ui";
import TaskDialog, { type TaskDraft } from "@/components/TaskDialog";
import { QueryParams, useSpotlight } from "@/components/deeplink";
import { taskFromFlag } from "@/components/flagTask";
import { inr, num, pct } from "@/lib/format";

type SortKey = keyof CampaignMetrics | "flag";

const COLS: { key: SortKey; label: string; help: string; fmt: (r: CampaignMetrics) => string }[] = [
  { key: "spend", label: "Spend", help: "Net ledger spend up to as-of (vendor credits subtract).", fmt: (r) => inr(r.spend) },
  { key: "registered", label: "Registered", help: "Distinct external people whose registration came from this campaign.", fmt: (r) => num(r.registered) },
  { key: "confirmed", label: "Confirmed", help: "Registered people whose latest status is confirmed (at event start, once the event begins).", fmt: (r) => num(r.confirmed) },
  { key: "attended", label: "Attended", help: "Distinct external people with an admitted + verified check-in, attributed via their registration.", fmt: (r) => (r.attended == null ? "not yet" : num(r.attended)) },
  { key: "showUpPct", label: "Show-up", help: "Attended / registered.", fmt: (r) => pct(r.showUpPct) },
  { key: "inrPerRegistration", label: "₹ / reg", help: "Spend / registered people.", fmt: (r) => inr(r.inrPerRegistration) },
  { key: "inrPerConfirmed", label: "₹ / confirmed", help: "Spend / confirmed people. The pre-event proxy for cost per attendee.", fmt: (r) => inr(r.inrPerConfirmed) },
  { key: "inrPerAttendee", label: "₹ / attendee", help: "Spend / actual attendees. The metric that matters for Challenge A.", fmt: (r) => inr(r.inrPerAttendee) },
  { key: "shareOfSpendPct", label: "% spend", help: "Share of total campaign spend.", fmt: (r) => pct(r.shareOfSpendPct) },
  { key: "shareOfAttendeesPct", label: "% attendees", help: "Share of campaign-attributed attendees. Compare with % spend.", fmt: (r) => pct(r.shareOfAttendeesPct) },
  { key: "engagedSharePct", label: "Engaged", help: "Share of registrants who submitted an event question. Context only: questions are recorded for some campaigns only.", fmt: (r) => pct(r.engagedSharePct) },
];

export default function CampaignsPage() {
  const { data, asOf, upsertPlan } = useStore();
  const mayEdit = canEdit(useAuth((s) => s.me), "campaigns");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "inrPerAttendee", dir: 1 });
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  useSpotlight(focus && `campaign-${focus}`);
  const res = useMemo(() => (data ? { t: campaignTable(data, asOf), f: flags(data, asOf) } : null), [data, asOf]);
  if (!data || !res) return null;
  const flagBy = new Map(res.f.value.flags.map((f) => [f.campaign_id, f]));
  const sponsorBy = new Map(data.sponsor_activations.map((s) => [s.attendee_campaign_id, s]));
  const taskCount = (id: string) => data.tasks.filter((t) => t.campaign_id === id && t.status !== "done").length;
  const order = { stop: 0, watch: 1, scale: 2 } as const;
  const rows = [...res.t.value.rows].sort((a, b) => {
    const va = sort.key === "flag" ? order[flagBy.get(a.campaign_id)?.level ?? "watch"] : (a[sort.key] as number | null);
    const vb = sort.key === "flag" ? order[flagBy.get(b.campaign_id)?.level ?? "watch"] : (b[sort.key] as number | null);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
  });
  const tot = res.t.value.totals;
  const th = (key: SortKey, label: string, help?: string) => (
    <th key={key} className="whitespace-nowrap px-2 py-2 text-right font-medium">
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : 1 })}>
        {label}
        {sort.key === key && <ArrowDownUp className="h-3 w-3" />}
      </button>{" "}
      {help && <Tip text={help} />}
    </th>
  );

  return (
    <div className="space-y-4">
      <QueryParams onParams={(p) => setFocus(p.get("focus"))} />
      {focus && !rows.some((r) => r.campaign_id === focus) && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">Campaign {focus} does not exist at the selected date.</p>}
      <PageHeader
        title="Campaigns"
        subtitle={`Ranked by cost per ${res.f.value.phase === "post-event" ? "actual attendee" : "confirmed registrant (pre-event proxy)"}. Status and budget are app data; everything else is computed from the source records.${mayEdit ? "" : ` View only for you. ${whoCanEdit("campaigns")}`}`}
        right={
          <Button variant="primary" onClick={() => setAdding(true)} disabled={!mayEdit} title={mayEdit ? undefined : whoCanEdit("campaigns")}>
            <Plus className="h-4 w-4" /> Add campaign
          </Button>
        }
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line text-[12px] text-muted">
              <tr>
                <th className="px-2 py-2 text-left font-medium">
                  <button className="inline-flex items-center gap-1" onClick={() => setSort({ key: "flag", dir: 1 })}>
                    Flag {sort.key === "flag" && <ArrowDownUp className="h-3 w-3" />}
                  </button>
                </th>
                <th className="px-2 py-2 text-left font-medium">Campaign</th>
                <th className="px-2 py-2 text-left font-medium">
                  Status <Badge kind="app" />
                </th>
                <th className="px-2 py-2 text-right font-medium">
                  Budget <Tip text="Per-campaign budget is app data (the source has only a total budget). Leave blank if not allocated." />
                </th>
                {COLS.map((c) => th(c.key, c.label, c.help))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const f = flagBy.get(r.campaign_id);
                const sp = sponsorBy.get(r.campaign_id);
                return (
                  <tr key={r.campaign_id} id={`campaign-${r.campaign_id}`} className="border-b border-line/70 hover:bg-subtle">
                    <td className="px-2 py-2">{f && <FlagChip level={f.level} title={f.reason} />}</td>
                    <td className="px-2 py-2">
                      <div className="font-medium">
                        <Link className="hover:text-brand hover:underline" href={`/campaigns/${encodeURIComponent(r.campaign_id)}`}>
                          {r.campaign_name}
                        </Link>{" "}
                        <span className="text-[11px] text-muted">{r.campaign_id}</span> {r.source === "app" && <Badge kind="app">NEW</Badge>}
                      </div>
                      <div className="text-[11px] text-muted">
                        {r.channel ?? "no channel"} · {r.owner_name ?? "no owner"}
                        {sp && (
                          <span title={sp.activation_note ?? ""} className="ml-1 rounded bg-app-soft px-1 text-app">
                            sponsor: {sp.brand_name}
                          </span>
                        )}
                        {taskCount(r.campaign_id) > 0 && <span className="ml-1">· {taskCount(r.campaign_id)} open task(s)</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <select className="rounded border border-line bg-panel px-1.5 py-0.5 text-[12px]" value={r.app_status} disabled={!mayEdit} onChange={(e) => upsertPlan(r.campaign_id, { app_status: e.target.value as "active" })}>
                        <option value="planned">planned</option>
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="stopped">stopped</option>
                      </select>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <BudgetCell key={`${r.campaign_id}-${r.budget_inr}`} value={r.budget_inr} used={r.budgetUsedPct} locked={!mayEdit} onSave={(v) => upsertPlan(r.campaign_id, { budget_inr: v })} />
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className={`tabular whitespace-nowrap px-2 py-2 text-right ${c.key === "inrPerAttendee" ? "font-semibold" : ""}`}>
                        {c.fmt(r)}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right">{f && <Button variant="ghost" onClick={() => setDraft(taskFromFlag(f, data, asOf))}>+ Task</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="text-[12px] font-semibold">
              <tr className="border-t border-line">
                <td className="px-2 py-2" colSpan={4}>
                  All campaigns (blended)
                </td>
                <td className="tabular px-2 py-2 text-right">{inr(tot.spend)}</td>
                <td className="tabular px-2 py-2 text-right">{num(tot.registered)}</td>
                <td />
                <td className="tabular px-2 py-2 text-right">{tot.attended == null ? "not yet" : num(tot.attended)}</td>
                <td className="tabular px-2 py-2 text-right">{tot.attended != null && tot.registered ? pct((tot.attended / tot.registered) * 100) : "n/a"}</td>
                <td className="tabular px-2 py-2 text-right">{inr(tot.blendedInrPerRegistration)}</td>
                <td className="tabular px-2 py-2 text-right">{inr(tot.blendedInrPerConfirmed)}</td>
                <td className="tabular px-2 py-2 text-right">{inr(tot.blendedInrPerAttendee)}</td>
                <td colSpan={4} />
              </tr>
              <tr className="text-muted">
                <td className="px-2 py-1 font-normal" colSpan={16}>
                  Unattributed: {num(res.t.value.unattributed.walkIns)} walk-in attendees (no registration, no campaign). They count toward actual attendees but not to any campaign.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <Caveats items={[...res.t.caveats, ...res.f.caveats]} basis={res.t.basis} />
      </Card>

      <Card title="Why each flag" help="Rules and thresholds live in Settings. Flags recompute instantly when data or thresholds change.">
        <ul className="space-y-2 text-[13px]">
          {res.f.value.flags.map((f) => (
            <li key={f.campaign_id} className="flex items-start gap-2">
              <FlagChip level={f.level} />
              <div>
                <span className="font-medium">{f.campaign_name}:</span> <span className="text-ink-2">{f.reason}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
      <AddCampaign open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function BudgetCell({ value, used, locked, onSave }: { value: number | null; used: number | null; locked: boolean; onSave: (v: number | null) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value == null ? "" : String(value));
  if (edit)
    return (
      <input
        autoFocus
        className="w-24 rounded border border-brand px-1.5 py-0.5 text-right text-[12px]"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => {
          setEdit(false);
          const n = v === "" ? null : Number(v);
          if (n !== value) onSave(n);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  return (
    <button className="tabular rounded px-1 text-right hover:bg-subtle-2" onClick={() => setEdit(true)} disabled={locked} title={locked ? whoCanEdit("campaign_plan") : "Click to edit"}>
      {value == null ? <span className="text-muted">{locked ? "none" : "set"}</span> : inr(value)}
      {used != null && <div className={`text-[11px] ${used > 100 ? "text-bad" : "text-muted"}`}>{pct(used, 0)} used</div>}
    </button>
  );
}

function AddCampaign({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addCampaign, asOf } = useStore();
  const nextId = useMemo(() => {
    const nums = (data?.campaigns ?? []).map((c) => Number(c.campaign_id.replace(/\D/g, ""))).filter(Number.isFinite);
    return `C${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0")}`;
  }, [data]);
  const [f, setF] = useState({ name: "", channel: "", audience: "", objective: "", owner: "", budget: "" });
  if (!open || !data) return null;
  const owner = data.team.find((t) => t.owner_id === f.owner);
  async function save() {
    const created = toIstIso(Date.parse(`${asOf}T09:00:00+05:30`));
    const ok = await addCampaign(
      {
        campaign_id: nextId,
        campaign_name: f.name.trim(),
        channel: f.channel.trim() || null,
        target_audience: f.audience.trim() || null,
        objective: f.objective.trim() || null,
        owner_id: owner?.owner_id ?? null,
        owner_name: owner?.owner_name ?? null,
        created_at: created,
        planned_start_at: created,
        planned_end_at: data!.event[0]?.event_ends_at ?? null,
      },
      f.budget ? Number(f.budget) : null,
    );
    if (ok) {
      setF({ name: "", channel: "", audience: "", objective: "", owner: "", budget: "" });
      onClose();
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Add campaign ${nextId}`}>
      <div className="space-y-3">
        <Field label="Campaign name">
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Health x AI Track Partners" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Channel">
            <input className={inputCls} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} placeholder="e.g. partnerships" />
          </Field>
          <Field label="Owner">
            <select className={inputCls} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
              <option value="">Unassigned</option>
              {data.team.map((m) => (
                <option key={m.owner_id} value={m.owner_id}>
                  {m.owner_name} ({m.team})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Target audience">
          <input className={inputCls} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />
        </Field>
        <Field label="Objective">
          <input className={inputCls} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} />
        </Field>
        <Field label="Planned budget (₹)" hint="Stored as app data. Spend only appears once daily marketing rows are added for this campaign (Data page).">
          <input className={inputCls} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value.replace(/[^\d]/g, "") })} />
        </Field>
        <p className="text-[12px] text-muted">Created as of {asOf}. It will not appear when viewing earlier dates (no leakage).</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!f.name.trim()}>
            Create campaign
          </Button>
        </div>
      </div>
    </Modal>
  );
}
