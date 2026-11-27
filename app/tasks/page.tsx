"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/store";
import { canEditTask, taskBlockReason } from "@/lib/auth/permissions";
import { tasksView } from "@/lib/engine";
import { Badge, Button, Card, Empty, Modal, PageHeader } from "@/components/ui";
import TaskDialog, { blankTask, type TaskDraft } from "@/components/TaskDialog";
import { QueryParams, useSpotlight } from "@/components/deeplink";
import { fmtDate } from "@/lib/format";

const STATUS = ["todo", "doing", "blocked", "done"] as const;
const LABEL = { todo: "To do", doing: "In progress", blocked: "Blocked", done: "Done" };

export default function TasksPage() {
  const { data, asOf, updateTask, deleteTask } = useStore();
  const me = useAuth((s) => s.me);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [status, setStatus] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  useSpotlight(focus && `task-${focus}`);
  const res = useMemo(() => (data ? tasksView(data, asOf, { status: status || undefined, overdueOnly }) : null), [data, asOf, status, overdueOnly]);
  if (!data || !res) return null;
  const v = res.value;
  const campaignName = (id: string | null) => (id ? (data.campaigns.find((c) => c.campaign_id === id)?.campaign_name ?? id) : null);
  const rows = [...v.rows].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.due_at ?? "9").localeCompare(b.due_at ?? "9"));

  return (
    <div className="space-y-4">
      <QueryParams
        onParams={(p) => {
          const id = p.get("focus");
          setFocus(id);
          // a linked task must not be hidden by a filter
          if (id) {
            setStatus("");
            setOverdueOnly(false);
          }
        }}
      />
      {focus && !data.tasks.some((t) => t.id === focus) && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">That task is no longer here. It may have been deleted, or cleared by a reset.</p>}
      <PageHeader
        title="Tasks"
        subtitle={`Overdue is judged against the as-of date (${asOf}), which the app treats as "today".`}
        right={
          <Button variant="primary" onClick={() => setDraft(blankTask(asOf))}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <button onClick={() => setStatus("")} className={`rounded-md px-2.5 py-1 ${status === "" ? "bg-ink text-white" : "border border-line bg-white"}`}>
          All ({data.tasks.length})
        </button>
        {STATUS.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-md px-2.5 py-1 ${status === s ? "bg-ink text-white" : "border border-line bg-white"}`}>
            {LABEL[s]} ({v.byStatus[s] ?? 0})
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only ({v.overdue})
        </label>
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty>{data.tasks.length === 0 ? "No tasks yet. Create one here, or turn a campaign flag into a task from Overview or Campaigns." : "No tasks match these filters."}</Empty>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="border-b border-line text-left text-[12px] text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Task</th>
                <th className="px-2 py-2 font-medium">Owner</th>
                <th className="px-2 py-2 font-medium">Campaign</th>
                <th className="px-2 py-2 font-medium">Due</th>
                <th className="px-2 py-2 font-medium">Priority</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Origin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const ref = t.origin_ref as { reason?: string; asOf?: string } | null;
                const mine = canEditTask(me, t.owner_id, data.team);
                const ticket = t.ticket_id ? data.tickets.find((x) => x.id === t.ticket_id) : null;
                const why = mine || !t.owner_id ? undefined : taskBlockReason(t.owner_id, data.team);
                return (
                  <tr key={t.id} id={`task-${t.id}`} className={`border-b border-line/60 align-top ${t.status === "done" ? "text-muted" : ""}`}>
                    <td className="max-w-md px-2 py-2">
                      <button className="text-left font-medium hover:text-brand" onClick={() => setDraft({ ...t })}>
                        {t.title}
                      </button>
                      {ref?.reason && <div className="mt-0.5 text-[12px] text-muted">Why: {ref.reason}</div>}
                      {ticket && (
                        <div className="mt-0.5 text-[12px]">
                          <Link className="text-brand underline" href={`/tickets?focus=${ticket.id}`}>
                            Ticket: {ticket.title}
                          </Link>
                          {ticket.simulation_note && <div className="text-[11px] font-semibold text-warn">{ticket.simulation_note}</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {t.owner_name ?? <span className="text-muted">unassigned</span>}
                      {t.team && <div className="text-[11px] text-muted">{t.team}</div>}
                    </td>
                    <td className="px-2 py-2">{campaignName(t.campaign_id) ?? <span className="text-muted">none</span>}</td>
                    <td className={`whitespace-nowrap px-2 py-2 ${t.overdue ? "font-semibold text-bad" : ""}`}>
                      {t.due_at ? fmtDate(t.due_at) : "none"}
                      {t.overdue && <div className="text-[11px]">overdue</div>}
                    </td>
                    <td className="px-2 py-2 capitalize">{t.priority}</td>
                    <td className="px-2 py-2">
                      <select className="rounded border border-line bg-white px-1.5 py-0.5 text-[12px]" value={t.status} disabled={!mine} title={why} onChange={(e) => updateTask(t.id, { status: e.target.value as TaskDraft["status"] })}>
                        {STATUS.map((s) => (
                          <option key={s} value={s}>
                            {LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <Badge kind={t.origin === "manual" ? "neutral" : t.origin === "rule" ? "assumption" : "projected"}>{t.origin.toUpperCase()}</Badge>
                      {ref?.asOf && <div className="mt-0.5 text-[11px] text-muted">as of {ref.asOf}</div>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button className="text-muted hover:text-bad disabled:opacity-30 disabled:hover:text-muted" disabled={!mine} title={why} onClick={() => setConfirmDelete(t.id)} aria-label="Delete task">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this task?">
        <p className="text-[13px]">The task is removed for everyone. The deletion is recorded in the change log.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              const id = confirmDelete!;
              setConfirmDelete(null);
              await deleteTask(id);
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
