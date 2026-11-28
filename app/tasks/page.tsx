"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Columns3, List, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/store";
import { canEditTask, taskBlockReason } from "@/lib/auth/permissions";
import { tasksView } from "@/lib/engine";
import { Badge, Button, Card, Empty, Modal, PageHeader } from "@/components/ui";
import TaskDialog, { blankTask, type TaskDraft } from "@/components/TaskDialog";
import SimulatedTag from "@/components/SimulatedTag";
import { QueryParams, useSpotlight } from "@/components/deeplink";
import { fmtDate } from "@/lib/format";

const STATUS = ["todo", "doing", "blocked", "done"] as const;
type Status = (typeof STATUS)[number];
const LABEL = { todo: "To do", doing: "In progress", blocked: "Blocked", done: "Done" };
const VIEW_KEY = "cf-tasks-view";
const selectCls = "rounded-md border border-line bg-panel px-2 py-1 text-[13px]";

export default function TasksPage() {
  const { data, asOf, updateTask, deleteTask } = useStore();
  const me = useAuth((s) => s.me);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [status, setStatus] = useState<string>("");
  const [owner, setOwner] = useState("");
  const [team, setTeam] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [view, setView] = useState<"list" | "board">("list");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  useSpotlight(focus && `task-${focus}`);

  // the list/board choice is remembered on this device
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "board") setView("board");
    } catch {
      /* storage blocked */
    }
  }, []);
  const chooseView = (v: "list" | "board") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage blocked */
    }
  };

  const board = view === "board";
  const res = useMemo(
    () => (data ? tasksView(data, asOf, { status: board ? undefined : status || undefined, owner_id: owner || undefined, team: team || undefined, overdueOnly }) : null),
    [data, asOf, status, owner, team, overdueOnly, board],
  );
  if (!data || !res) return null;
  const v = res.value;
  const campaignName = (id: string | null) => (id ? (data.campaigns.find((c) => c.campaign_id === id)?.campaign_name ?? id) : null);
  const rows = [...v.rows].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.due_at ?? "9").localeCompare(b.due_at ?? "9"));
  const teams = [...new Set(data.team.map((m) => m.team).filter(Boolean))].sort();
  const owners = data.team.filter((m) => !team || m.team === team);
  const filtered = !!(owner || team || overdueOnly || (!board && status));

  const campaignCell = (id: string | null) =>
    id ? (
      <Link className="hover:text-brand hover:underline" href={`/campaigns/${encodeURIComponent(id)}`}>
        {campaignName(id)}
      </Link>
    ) : (
      <span className="text-muted">none</span>
    );

  return (
    <div className="space-y-4">
      <QueryParams
        onParams={(p) => {
          const id = p.get("focus");
          setFocus(id);
          // a linked task must not be hidden by a filter
          if (id) {
            setStatus("");
            setOwner("");
            setTeam("");
            setOverdueOnly(false);
          }
        }}
      />
      {focus && !data.tasks.some((t) => t.id === focus) && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">That task is no longer here. It may have been deleted, or cleared by a reset.</p>}
      <PageHeader
        title="Tasks"
        subtitle={`Overdue is judged against the as-of date (${asOf}), which the app treats as "today".`}
        right={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-line bg-panel p-0.5 text-[12px]" role="group" aria-label="View">
              <button onClick={() => chooseView("list")} className={`flex items-center gap-1 rounded px-2 py-1 ${!board ? "bg-ink text-on-accent" : "text-muted"}`} aria-pressed={!board}>
                <List className="h-3.5 w-3.5" /> List
              </button>
              <button onClick={() => chooseView("board")} className={`flex items-center gap-1 rounded px-2 py-1 ${board ? "bg-ink text-on-accent" : "text-muted"}`} aria-pressed={board}>
                <Columns3 className="h-3.5 w-3.5" /> Board
              </button>
            </div>
            <Button variant="primary" onClick={() => setDraft(blankTask(asOf))}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {!board && (
          <>
            <button onClick={() => setStatus("")} className={`rounded-md px-2.5 py-1 ${status === "" ? "bg-ink text-on-accent" : "border border-line bg-panel"}`}>
              All ({data.tasks.length})
            </button>
            {STATUS.map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={`rounded-md px-2.5 py-1 ${status === s ? "bg-ink text-on-accent" : "border border-line bg-panel"}`}>
                {LABEL[s]} ({v.byStatus[s] ?? 0})
              </button>
            ))}
          </>
        )}
        <select
          className={selectCls}
          value={team}
          onChange={(e) => {
            setTeam(e.target.value);
            if (e.target.value && owner && data.team.find((m) => m.owner_id === owner)?.team !== e.target.value) setOwner("");
          }}
          aria-label="Team"
        >
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <select className={selectCls} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          {owners.map((m) => (
            <option key={m.owner_id} value={m.owner_id}>
              {m.owner_name}
            </option>
          ))}
        </select>
        <label className="ml-1 flex items-center gap-1.5">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only ({v.overdue})
        </label>
        {filtered && (
          <button
            className="text-[12px] text-brand hover:underline"
            onClick={() => {
              setStatus("");
              setOwner("");
              setTeam("");
              setOverdueOnly(false);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {board ? (
        data.tasks.length === 0 ? (
          <Card>
            <Empty>No tasks yet. Create one here, or turn a campaign flag into a task from Overview or Campaigns.</Empty>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {STATUS.map((col, ci) => {
              const cards = rows.filter((t) => t.status === col);
              return (
                <div key={col} className="flex min-h-40 flex-col rounded-lg border border-line bg-subtle p-2">
                  <div className="mb-2 flex items-center justify-between px-1 text-[12px] font-semibold">
                    <span>{LABEL[col]}</span>
                    <span className="text-muted">{cards.length}</span>
                  </div>
                  <div className="space-y-2">
                    {cards.length === 0 && <p className="px-1 py-3 text-center text-[12px] text-muted">{filtered ? "None match these filters." : "Nothing here."}</p>}
                    {cards.map((t) => {
                      const mine = canEditTask(me, t.owner_id, data.team);
                      const why = mine || !t.owner_id ? undefined : taskBlockReason(t.owner_id, data.team);
                      const ticket = t.ticket_id ? data.tickets.find((x) => x.id === t.ticket_id) : null;
                      const move = (to: Status) => updateTask(t.id, { status: to });
                      return (
                        <div key={t.id} id={`task-${t.id}`} className={`rounded-md border border-line bg-panel p-2.5 text-[13px] shadow-sm ${col === "done" ? "text-muted" : ""}`}>
                          <button className="text-left font-medium leading-snug hover:text-brand" onClick={() => setDraft({ ...t })}>
                            {t.title}
                          </button>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                            <span>{t.owner_name ?? "unassigned"}</span>
                            <span>·</span>
                            <span className="capitalize">{t.priority}</span>
                            {t.due_at && (
                              <>
                                <span>·</span>
                                <span className={t.overdue ? "font-semibold text-bad" : ""}>
                                  {fmtDate(t.due_at)}
                                  {t.overdue ? ", overdue" : ""}
                                </span>
                              </>
                            )}
                            {ticket?.simulation_note && <SimulatedTag note={ticket.simulation_note} />}
                          </div>
                          {t.campaign_id && <div className="mt-1 text-[11px]">{campaignCell(t.campaign_id)}</div>}
                          <div className="mt-2 flex items-center justify-between">
                            <button className="rounded p-1 text-muted hover:bg-subtle-2 disabled:opacity-30" disabled={!mine || ci === 0} title={why ?? (ci > 0 ? `Move to ${LABEL[STATUS[ci - 1]]}` : undefined)} onClick={() => move(STATUS[ci - 1])} aria-label={ci > 0 ? `Move to ${LABEL[STATUS[ci - 1]]}` : "Move left"}>
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <select className="rounded border border-line bg-panel px-1 py-0.5 text-[11px]" value={t.status} disabled={!mine} title={why} onChange={(e) => move(e.target.value as Status)} aria-label="Status">
                              {STATUS.map((s) => (
                                <option key={s} value={s}>
                                  {LABEL[s]}
                                </option>
                              ))}
                            </select>
                            <button className="rounded p-1 text-muted hover:bg-subtle-2 disabled:opacity-30" disabled={!mine || ci === STATUS.length - 1} title={why ?? (ci < STATUS.length - 1 ? `Move to ${LABEL[STATUS[ci + 1]]}` : undefined)} onClick={() => move(STATUS[ci + 1])} aria-label={ci < STATUS.length - 1 ? `Move to ${LABEL[STATUS[ci + 1]]}` : "Move right"}>
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
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
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                            <Link className="text-brand underline" href={`/tickets?focus=${ticket.id}`}>
                              Ticket: {ticket.title}
                            </Link>
                            {ticket.simulation_note && <SimulatedTag note={ticket.simulation_note} />}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {t.owner_name ?? <span className="text-muted">unassigned</span>}
                        {t.team && <div className="text-[11px] text-muted">{t.team}</div>}
                      </td>
                      <td className="px-2 py-2">{campaignCell(t.campaign_id)}</td>
                      <td className={`whitespace-nowrap px-2 py-2 ${t.overdue ? "font-semibold text-bad" : ""}`}>
                        {t.due_at ? fmtDate(t.due_at) : "none"}
                        {t.overdue && <div className="text-[11px]">overdue</div>}
                      </td>
                      <td className="px-2 py-2 capitalize">{t.priority}</td>
                      <td className="px-2 py-2">
                        <select className="rounded border border-line bg-panel px-1.5 py-0.5 text-[12px]" value={t.status} disabled={!mine} title={why} onChange={(e) => updateTask(t.id, { status: e.target.value as TaskDraft["status"] })}>
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
      )}
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
