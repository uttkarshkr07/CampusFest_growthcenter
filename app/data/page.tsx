"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/store";
import { canEdit, whoCanEdit } from "@/lib/auth/permissions";
import { Badge, Button, Card, Empty, Field, PageHeader, inputCls } from "@/components/ui";
import EditableTable, { type ColSpec } from "@/components/EditableTable";
import { fmtDate, fmtDateTime, inr, num } from "@/lib/format";

const TABS = ["Targets", "Campaigns", "Daily marketing", "Check-ins", "Registration history", "Recent changes"] as const;
type Tab = (typeof TABS)[number];

const CAMPAIGN_COLS: ColSpec[] = [
  { key: "campaign_id", label: "campaign_id", editable: false, required: true },
  { key: "campaign_name", label: "Name", required: true },
  { key: "channel", label: "Channel" },
  { key: "owner_id", label: "owner_id" },
  { key: "owner_name", label: "Owner" },
  { key: "created_at", label: "Created (IST)", type: "datetime", required: true },
  { key: "planned_start_at", label: "Planned start", type: "datetime" },
  { key: "planned_end_at", label: "Planned end", type: "datetime" },
];

const DAILY_COLS: ColSpec[] = [
  { key: "activity_id", label: "activity_id", required: true },
  { key: "campaign_id", label: "campaign_id", required: true },
  { key: "activity_date", label: "Date", type: "date", required: true },
  { key: "marketing_spend_inr", label: "Spend ₹", type: "number" },
  { key: "impressions", label: "Impr.", type: "number" },
  { key: "clicks", label: "Clicks", type: "number" },
  { key: "reported_reach", label: "Reach", type: "number" },
  { key: "landing_page_sessions", label: "Sessions", type: "number" },
  { key: "registration_starts", label: "Reg. starts", type: "number" },
  { key: "platform", label: "Platform" },
];

const CHECKIN_COLS: ColSpec[] = [
  { key: "event_id", label: "event_id", required: true },
  { key: "person_id", label: "person_id", required: true },
  { key: "registration_id", label: "registration_id" },
  { key: "campaign_id", label: "campaign_id" },
  { key: "occurred_at", label: "Occurred (IST)", type: "datetime", required: true },
  { key: "result", label: "Result", type: "select", options: ["admitted", "denied", "pending"], required: true },
  { key: "verification", label: "Verification", type: "select", options: ["verified", "unverified"], required: true },
  { key: "source", label: "Source", type: "select", options: ["scanner", "manual"] },
];

const HISTORY_COLS: ColSpec[] = [
  { key: "history_id", label: "history_id", required: true },
  { key: "registration_id", label: "registration_id", required: true },
  { key: "person_id", label: "person_id", required: true },
  { key: "campaign_id", label: "campaign_id" },
  { key: "effective_at", label: "Effective (IST)", type: "datetime", required: true },
  { key: "status", label: "Status", type: "select", options: ["interested", "confirmed", "cancelled", "waitlisted"], required: true },
];

function nextId(rows: Record<string, unknown>[], key: string, prefix: string, width: number) {
  let max = 0;
  for (const r of rows) {
    const m = String(r[key] ?? "").match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

export default function DataPage() {
  const [tab, setTab] = useState<Tab>("Targets");
  const { asOf } = useStore();
  const at = `${asOf}T12:00:00+05:30`;
  return (
    <div className="space-y-4">
      <PageHeader title="Data" subtitle="Edit the working copy of the source data. Every change is saved, logged, and recalculates every number in the app. Reset demo data restores the original." />
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${tab === t ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>
      <Card>
        {tab === "Targets" && <TargetsEditor />}
        {tab === "Campaigns" && <EditableTable table="campaigns" idField="campaign_id" cols={CAMPAIGN_COLS} searchKeys={["campaign_id", "campaign_name"]} defaults={(rows) => ({ campaign_id: nextId(rows, "campaign_id", "C", 2), created_at: at })} note="To add a campaign with a budget and status, use Campaigns > Add campaign." />}
        {tab === "Daily marketing" && (
          <EditableTable
            table="daily_marketing"
            idField="activity_id"
            cols={DAILY_COLS}
            searchKeys={["activity_id", "campaign_id", "activity_date"]}
            defaults={() => ({ activity_date: asOf, platform: "manual entry" })}
            note="Spend is net (negative = vendor credit). Impressions, clicks, reach and sessions are anonymous counts, never people. Duplicate activity_ids count once."
          />
        )}
        {tab === "Check-ins" && (
          <EditableTable
            table="checkins"
            idField="event_id"
            cols={CHECKIN_COLS}
            searchKeys={["event_id", "person_id", "registration_id"]}
            defaults={(rows) => ({ event_id: nextId(rows, "event_id", "CHK", 6), occurred_at: at, result: "admitted", verification: "verified", source: "manual" })}
            note="Only admitted + verified check-ins of external people count as attendance. Try: change one result to denied and watch Overview."
          />
        )}
        {tab === "Registration history" && (
          <EditableTable
            table="registration_history"
            idField="history_id"
            cols={HISTORY_COLS}
            searchKeys={["history_id", "registration_id", "person_id"]}
            defaults={(rows) => ({ history_id: nextId(rows, "history_id", "RH", 6), effective_at: at })}
            note="Histories are full-state: to change a registration's status, ADD a new version with a later effective time (that is how the source records it)."
          />
        )}
        {tab === "Recent changes" && <RecentChanges />}
      </Card>
    </div>
  );
}

function TargetsEditor() {
  const { data, addTargetVersion, asOf } = useStore();
  const mayEdit = canEdit(useAuth((s) => s.me), "targets");
  const sorted = useMemo(() => [...(data?.targets ?? [])].sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at)), [data]);
  const last = sorted[sorted.length - 1];
  const [f, setF] = useState({
    effective: `${asOf}T09:00`,
    name: "",
    identified: String(last?.identified_external_people_goal ?? ""),
    registered: String(last?.registration_goal ?? ""),
    visitors: String(last?.unique_external_visitors_goal ?? ""),
    budget: String(last?.marketing_budget_inr ?? ""),
  });
  if (!data) return null;
  const valid = f.name.trim() && f.effective && [f.identified, f.registered, f.visitors, f.budget].every((x) => x !== "" && Number.isFinite(Number(x)));
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Targets are versioned. A new version takes effect from its effective time; earlier dates keep the old targets, so history never changes.</p>
      <table className="w-full text-[13px]">
        <thead className="border-b border-line text-left text-[12px] text-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">Version</th>
            <th className="px-2 py-1.5 font-medium">Effective from</th>
            <th className="px-2 py-1.5 text-right font-medium">Identified goal</th>
            <th className="px-2 py-1.5 text-right font-medium">Registration goal</th>
            <th className="px-2 py-1.5 text-right font-medium">Visitors goal</th>
            <th className="px-2 py-1.5 text-right font-medium">Budget</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t._row_id ?? t.effective_at} className="border-b border-line/60">
              <td className="px-2 py-1.5 font-medium">{t.target_version}</td>
              <td className="px-2 py-1.5">{fmtDateTime(t.effective_at)}</td>
              <td className="tabular px-2 py-1.5 text-right">{num(Number(t.identified_external_people_goal))}</td>
              <td className="tabular px-2 py-1.5 text-right">{num(Number(t.registration_goal))}</td>
              <td className="tabular px-2 py-1.5 text-right">{num(Number(t.unique_external_visitors_goal))}</td>
              <td className="tabular px-2 py-1.5 text-right">{inr(Number(t.marketing_budget_inr))}</td>
              <td className="px-2 py-1.5">{t._source === "app" ? <Badge kind="app" /> : <Badge kind="sourced" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!mayEdit && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">View only for you. {whoCanEdit("targets")}</p>}
      <div className={mayEdit ? "rounded-md border border-line p-3" : "hidden"}>
        <div className="mb-2 text-[13px] font-semibold">Add a new target version</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Version name">
            <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Stretch plan" />
          </Field>
          <Field label="Effective from (IST)">
            <input type="datetime-local" className={inputCls} value={f.effective} onChange={(e) => setF({ ...f, effective: e.target.value })} />
          </Field>
          <Field label="Identified external goal">
            <input className={inputCls} value={f.identified} onChange={(e) => setF({ ...f, identified: e.target.value })} />
          </Field>
          <Field label="Registration goal">
            <input className={inputCls} value={f.registered} onChange={(e) => setF({ ...f, registered: e.target.value })} />
          </Field>
          <Field label="Verified visitors goal">
            <input className={inputCls} value={f.visitors} onChange={(e) => setF({ ...f, visitors: e.target.value })} />
          </Field>
          <Field label="Marketing budget (₹)">
            <input className={inputCls} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            disabled={!valid}
            onClick={async () => {
              const ok = await addTargetVersion({
                effective_at: `${f.effective}:00+05:30`,
                target_version: f.name.trim(),
                identified_external_people_goal: Number(f.identified),
                registration_goal: Number(f.registered),
                unique_external_visitors_goal: Number(f.visitors),
                marketing_budget_inr: Number(f.budget),
              });
              if (ok) setF({ ...f, name: "" });
            }}
          >
            Add version
          </Button>
        </div>
      </div>
    </div>
  );
}

function RecentChanges() {
  const { data } = useStore();
  const rows = [...(data?.change_log ?? [])].reverse().slice(0, 100);
  if (rows.length === 0) return <Empty>No edits yet. Changes made in the app appear here (and feed diagnosis of what moved the numbers).</Empty>;
  const show = (v: unknown) => (v == null ? "empty" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v));
  return (
    <table className="w-full text-[12px]">
      <thead className="border-b border-line text-left text-muted">
        <tr>
          <th className="px-2 py-1.5 font-medium">When (real time)</th>
          <th className="px-2 py-1.5 font-medium">Table</th>
          <th className="px-2 py-1.5 font-medium">Row</th>
          <th className="px-2 py-1.5 font-medium">Field</th>
          <th className="px-2 py-1.5 font-medium">Old</th>
          <th className="px-2 py-1.5 font-medium">New</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.id)} className="border-b border-line/60">
            <td className="whitespace-nowrap px-2 py-1">{fmtDate(r.changed_at)} {new Date(r.changed_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}</td>
            <td className="px-2 py-1">{r.table_name}</td>
            <td className="px-2 py-1 font-mono">{r.row_ref}</td>
            <td className="px-2 py-1">{r.field}</td>
            <td className="px-2 py-1 text-muted">{show(r.old_value)}</td>
            <td className="px-2 py-1">{show(r.new_value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

