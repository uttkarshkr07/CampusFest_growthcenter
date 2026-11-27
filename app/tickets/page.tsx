"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { QueryParams } from "@/components/deeplink";
import TaskDialog, { blankTask, type TaskDraft } from "@/components/TaskDialog";
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, inputCls } from "@/components/ui";
import { canActFor, canEditTask, whoCanActFor } from "@/lib/auth/permissions";
import { useAuth } from "@/lib/auth/store";
import { NEXT_STATUSES, STATUS_LABEL, TICKET_TEAMS, awaiting, ticketsAt, type TicketAtDate } from "@/lib/engine/tickets";
import type { TicketRow, TicketStatus } from "@/lib/engine/types";
import { fmtDate } from "@/lib/format";
import { useStore, type TicketInput } from "@/lib/store";

const FILTERS = ["All", "Waiting for my team", "Raised by my team", "Finished"] as const;
type Filter = (typeof FILTERS)[number];
const PAGE_SIZE = 20;

const teamName = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const ACTION_LABEL: Partial<Record<TicketStatus, string>> = { accepted: "Accept", declined: "Decline", in_progress: "Start work", done: "Mark done" };
const WHAT: Record<string, string> = { raised: "Raised", comment: "Comment", accepted: "Accepted", declined: "Declined", in_progress: "Work started", done: "Marked done", edited: "Request changed" };
const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-warn-soft text-warn",
  accepted: "bg-brand-soft text-brand",
  in_progress: "bg-brand-soft text-brand",
  done: "bg-good-soft text-good",
  declined: "bg-slate-100 text-slate-600",
};

function Status({ status }: { status: TicketStatus }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

function Simulated({ note }: { note: string }) {
  return <div className="rounded border border-amber-300 bg-warn-soft px-2 py-1 text-[12px] font-semibold text-warn">{note}</div>;
}

function Due({ t }: { t: TicketAtDate }) {
  if (!t.needed_by) return <span>no date set</span>;
  return (
    <span className={t.overdue ? "font-semibold text-bad" : ""}>
      needed by {fmtDate(t.needed_by)}
      {t.overdue ? ", overdue" : t.daysLeft != null ? `, ${t.daysLeft === 0 ? "due today" : `${t.daysLeft} days left`}` : ""}
    </span>
  );
}

export default function TicketsPage() {
  const { data, asOf, ticketsReady } = useStore();
  const me = useAuth((s) => s.me);
  const [filter, setFilter] = useState<Filter>("All");
  const [openId, setOpenId] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const tickets = useMemo(() => (data ? ticketsAt(data, asOf) : []), [data, asOf]);

  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filter, asOf]);

  if (!data) return null;
  const everyTeam = !me || me.isReviewer;
  const myTeams: readonly string[] = everyTeam ? TICKET_TEAMS : me.teams;
  const waiting = awaiting(tickets, myTeams);
  const shown = tickets.filter((t) =>
    filter === "Waiting for my team" ? waiting.includes(t) : filter === "Raised by my team" ? myTeams.includes(t.from_team) : filter === "Finished" ? t.finished : true,
  );
  const names = new Map(data.team.map((m) => [m.owner_id, m.owner_name]));
  const open = tickets.find((t) => t.id === openId) ?? null;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const at = Math.min(page, pages);

  return (
    <div className="space-y-4">
      {/* links from tasks and the copilot arrive as /tickets?focus=<id> */}
      <QueryParams
        onParams={(p) => {
          const id = p.get("focus");
          if (id) setOpenId(id);
        }}
      />
      {openId && !open && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">That ticket does not exist at the selected date.</p>}
      <PageHeader
        title="Tickets between teams"
        subtitle={`Requests one team raises with another, shown as they stood at the end of ${fmtDate(asOf)}. Everyone can read and comment.`}
        right={
          <Button variant="primary" onClick={() => setRaising(true)} disabled={!ticketsReady}>
            <Plus className="h-4 w-4" /> Raise a ticket
          </Button>
        }
      />
      {!ticketsReady ? (
        <Empty>Tickets are not set up in the database yet.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-[13px]">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-ink text-white" : "border border-line bg-white"}`}>
                {f}
                {f === "Waiting for my team" ? ` (${waiting.length})` : f === "All" ? ` (${tickets.length})` : ""}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty>{tickets.length === 0 ? "No tickets had been raised by this date." : "No tickets match this filter."}</Empty>
          ) : (
            <div className="space-y-2">
              {shown.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE).map((t) => (
                <Card key={t.id}>
                  <button className="w-full text-left" onClick={() => setOpenId(t.id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Status status={t.status} />
                      <span className="text-[14px] font-semibold hover:text-brand">{t.title}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-muted">
                      {teamName(t.from_team)} to {teamName(t.to_team)} · {t.priority} priority · <Due t={t} />
                      {t.assignee_id ? ` · for ${names.get(t.assignee_id) ?? t.assignee_id}` : ""} · raised {fmtDate(t.raised_on)}
                    </div>
                    {t.declineReason && <div className="mt-1 text-[12px]">Reason for declining: {t.declineReason}</div>}
                    {t.simulation_note && (
                      <div className="mt-2">
                        <Simulated note={t.simulation_note} />
                      </div>
                    )}
                  </button>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <Button disabled={at <= 1} onClick={() => setPage(at - 1)}>
            Previous
          </Button>
          <span className="text-muted">
            Page {at} of {pages}
          </span>
          <Button disabled={at >= pages} onClick={() => setPage(at + 1)}>
            Next
          </Button>
        </div>
      )}
      {open && <TicketDialog key={`${open.id}-${asOf}`} ticket={open} onClose={() => setOpenId(null)} />}
      {raising && <TicketForm onClose={() => setRaising(false)} />}
    </div>
  );
}

function TicketDialog({ ticket: t, onClose }: { ticket: TicketAtDate; onClose: () => void }) {
  const { data, asOf, moveTicket, commentTicket, saving } = useStore();
  const me = useAuth((s) => s.me);
  const [comment, setComment] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  if (!data) return null;
  if (editing) return <TicketForm existing={t} onClose={() => setEditing(false)} />;

  const names = new Map(data.team.map((m) => [m.owner_id, m.owner_name]));
  // a change cannot be dated before one that already happened
  const lastChange = data.ticket_events
    .filter((e) => e.ticket_id === t.id && e.kind !== "comment")
    .reduce((m, e) => (e.story_date.slice(0, 10) > m ? e.story_date.slice(0, 10) : m), "");
  const tooEarly = lastChange > asOf ? `This ticket has later activity. To change it, select ${fmtDate(lastChange)} or a later date.` : null;
  const canDecide = canActFor(me, t.to_team);
  const canEditRequest = canActFor(me, t.from_team) && !t.finished;
  const next = NEXT_STATUSES[t.status];
  const tasks = data.tasks.filter((x) => x.ticket_id === t.id && (!x.story_date || x.story_date.slice(0, 10) <= asOf));
  const addTask = () =>
    setDraft(
      blankTask(asOf, {
        title: "",
        description: t.simulation_note ?? "",
        ticket_id: t.id,
        owner_id: t.assignee_id && canEditTask(me, t.assignee_id, data.team) ? t.assignee_id : null,
        priority: t.priority,
      }),
    );

  return (
    <>
      <Modal open={!draft} onClose={onClose} title={t.title} width="max-w-2xl">
        <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[13px]">
          {t.simulation_note && <Simulated note={t.simulation_note} />}
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <Status status={t.status} />
            <span>
              {teamName(t.from_team)} to {teamName(t.to_team)} · {t.priority} priority · <Due t={t} />
              {t.assignee_id ? ` · for ${names.get(t.assignee_id) ?? t.assignee_id}` : ""}
            </span>
          </div>
          <p className="whitespace-pre-wrap">{t.details || "No details given."}</p>

          {next.length > 0 && (
            <div className="rounded-md border border-line p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold">{teamName(t.to_team)} team:</span>
                {next.map((s) => (
                  <Button
                    key={s}
                    variant={s === "declined" ? "default" : "primary"}
                    disabled={!canDecide || !!tooEarly || saving}
                    title={!canDecide ? whoCanActFor(t.to_team) : (tooEarly ?? undefined)}
                    onClick={() => (s === "declined" ? setDeclining(true) : void moveTicket(t.id, s, null))}
                  >
                    {ACTION_LABEL[s]}
                  </Button>
                ))}
              </div>
              {!canDecide && <p className="mt-1 text-[12px] text-muted">{whoCanActFor(t.to_team)}</p>}
              {canDecide && tooEarly && <p className="mt-1 text-[12px] text-warn">{tooEarly}</p>}
              {declining && canDecide && !tooEarly && (
                <div className="mt-2 space-y-2">
                  <Field label="Why are you declining? (optional)">
                    <textarea className={inputCls} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      disabled={saving}
                      onClick={async () => {
                        if (await moveTicket(t.id, "declined", reason.trim() || null)) setDeclining(false);
                      }}
                    >
                      Confirm decline
                    </Button>
                    <Button onClick={() => setDeclining(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={addTask}>
              <Plus className="h-3.5 w-3.5" /> Add a task for this ticket
            </Button>
            {canEditRequest && (
              <Button onClick={() => setEditing(true)} disabled={!!tooEarly} title={tooEarly ?? undefined}>
                Edit the request
              </Button>
            )}
          </div>
          {tasks.length > 0 && (
            <div>
              <div className="text-[12px] font-semibold">Tasks for this ticket</div>
              <ul className="list-disc pl-5">
                {tasks.map((x) => (
                  <li key={x.id}>
                    <Link className="text-brand underline" href={`/tasks?focus=${x.id}`}>
                      {x.title}
                    </Link>{" "}
                    <span className="text-muted">
                      {x.owner_id ? (names.get(x.owner_id) ?? x.owner_id) : "unassigned"}, {x.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-[12px] font-semibold">History</div>
            <ul className="mt-1 space-y-1">
              {t.events.map((e) => (
                <li key={e.id} className="rounded border border-line px-2 py-1">
                  <span className="text-[12px] text-muted">
                    {fmtDate(e.story_date)} · {WHAT[e.kind] ?? e.kind} by {e.actor_name}
                  </span>
                  {e.body && <div className="whitespace-pre-wrap">{e.body}</div>}
                </li>
              ))}
            </ul>
          </div>

          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (comment.trim() && (await commentTicket(t.id, comment.trim()))) setComment("");
            }}
          >
            <Field label={`Comment (dated ${fmtDate(asOf)})`}>
              <textarea className={inputCls} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={!comment.trim() || saving}>
                Post comment
              </Button>
            </div>
          </form>
        </div>
      </Modal>
      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
    </>
  );
}

function TicketForm({ existing, onClose }: { existing?: TicketRow; onClose: () => void }) {
  const { data, asOf, raiseTicket, editTicket, saving } = useStore();
  const me = useAuth((s) => s.me);
  const myTeams = TICKET_TEAMS.filter((team) => canActFor(me, team));
  const [from, setFrom] = useState<string>(existing?.from_team ?? myTeams[0] ?? "publicity");
  const [to, setTo] = useState<string>(existing?.to_team ?? TICKET_TEAMS.find((x) => x !== (myTeams[0] ?? "publicity"))!);
  const [assignee, setAssignee] = useState("");
  const [f, setF] = useState<TicketInput>({
    title: existing?.title ?? "",
    details: existing?.details ?? "",
    priority: existing?.priority ?? "medium",
    neededBy: existing?.needed_by?.slice(0, 10) ?? null,
  });
  if (!data) return null;
  const people = data.team.filter((m) => m.team === to);
  const earliest = existing?.raised_on.slice(0, 10) ?? asOf;
  const dateError = f.neededBy && f.neededBy < earliest ? `The needed-by date cannot be before ${fmtDate(earliest)}.` : null;
  const valid = f.title.trim() && from !== to && !dateError;

  async function save() {
    const input = { ...f, title: f.title.trim(), details: f.details.trim() };
    const ok = existing ? await editTicket(existing.id, input) : await raiseTicket({ ...input, fromTeam: from, toTeam: to, assigneeId: people.some((p) => p.owner_id === assignee) ? assignee : null });
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={existing ? "Edit the request" : "Raise a ticket"} width="max-w-xl">
      <div className="space-y-3">
        {existing?.simulation_note && <Simulated note={existing.simulation_note} />}
        {!existing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From team">
              <select
                className={inputCls}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (e.target.value === to) setTo(TICKET_TEAMS.find((x) => x !== e.target.value)!);
                }}
              >
                {myTeams.map((team) => (
                  <option key={team} value={team}>
                    {teamName(team)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To team">
              <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
                {TICKET_TEAMS.filter((x) => x !== from).map((team) => (
                  <option key={team} value={team}>
                    {teamName(team)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <Field label="Title">
          <input className={inputCls} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
        </Field>
        <Field label="What is needed">
          <textarea className={inputCls} rows={7} maxLength={4000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <select className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketInput["priority"] })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
          <Field label="Needed by">
            <input type="date" className={inputCls} min={earliest} value={f.neededBy ?? ""} onChange={(e) => setF({ ...f, neededBy: e.target.value || null })} />
          </Field>
        </div>
        {!existing && (
          <Field label="For (optional)">
            <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Anyone in the team</option>
              {people.map((p) => (
                <option key={p.owner_id} value={p.owner_id}>
                  {p.owner_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {dateError && <p className="text-[12px] text-bad">{dateError}</p>}
        <p className="text-[12px] text-muted">
          {existing ? "The change" : "The ticket"} is dated {fmtDate(asOf)}. It will not appear when an earlier date is selected. <Badge kind="app" />
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!valid || saving}>
            {existing ? "Save changes" : "Raise ticket"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
