"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { TaskRow } from "@/lib/engine";
import { addDays } from "@/lib/engine";
import { Button, Field, Modal, inputCls } from "./ui";

export type TaskDraft = Omit<TaskRow, "id" | "created_at" | "updated_at"> & { id?: string };

export function blankTask(asOf: string, patch: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: "",
    description: "",
    campaign_id: null,
    owner_id: null,
    due_at: `${addDays(asOf, 3)}T18:00:00+05:30`,
    status: "todo",
    priority: "medium",
    origin: "manual",
    origin_ref: null,
    ...patch,
  };
}

export default function TaskDialog({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial: TaskDraft | null; onSaved?: (task: TaskRow | null) => void }) {
  const { data, createTask, updateTask } = useStore();
  const [t, setT] = useState<TaskDraft | null>(initial);
  useEffect(() => setT(initial), [initial]);
  if (!open || !t || !data) return null;
  const set = (patch: Partial<TaskDraft>) => setT({ ...t, ...patch });
  const ref = t.origin_ref as Record<string, unknown> | null;

  async function save() {
    if (!t || !t.title.trim()) return;
    const { id } = t;
    // only real columns: the task list passes view fields (overdue, owner_name, team) too
    const rest = {
      title: t.title.trim(),
      description: t.description,
      campaign_id: t.campaign_id,
      owner_id: t.owner_id,
      due_at: t.due_at,
      status: t.status,
      priority: t.priority,
      origin: t.origin,
      origin_ref: t.origin_ref,
    };
    const ok = id ? await updateTask(id, rest) : await createTask(rest);
    if (ok) {
      onSaved?.(typeof ok === "object" ? ok : null);
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t.id ? "Edit task" : "New task"} width="max-w-xl">
      <div className="space-y-3">
        <Field label="Title">
          <input className={inputCls} value={t.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
        </Field>
        <Field label="Description">
          <textarea className={inputCls} rows={3} value={t.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <select className={inputCls} value={t.owner_id ?? ""} onChange={(e) => set({ owner_id: e.target.value || null })}>
              <option value="">Unassigned</option>
              {data.team.map((m) => (
                <option key={m.owner_id} value={m.owner_id}>
                  {m.owner_name} ({m.team})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Linked campaign">
            <select className={inputCls} value={t.campaign_id ?? ""} onChange={(e) => set({ campaign_id: e.target.value || null })}>
              <option value="">None</option>
              {data.campaigns.map((c) => (
                <option key={c._row_id ?? c.campaign_id} value={c.campaign_id}>
                  {c.campaign_id} {c.campaign_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" className={inputCls} value={(t.due_at ?? "").slice(0, 10)} onChange={(e) => set({ due_at: e.target.value ? `${e.target.value}T18:00:00+05:30` : null })} />
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={t.priority} onChange={(e) => set({ priority: e.target.value as TaskDraft["priority"] })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={t.status} onChange={(e) => set({ status: e.target.value as TaskDraft["status"] })}>
              <option value="todo">To do</option>
              <option value="doing">Doing</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
          </Field>
          <Field label="Origin">
            <input className={`${inputCls} bg-slate-50`} value={t.origin} readOnly />
          </Field>
        </div>
        {ref && (
          <div className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-700">
            <div className="mb-1 font-semibold">Why this task exists (snapshot at creation)</div>
            {typeof ref.reason === "string" && <div>{ref.reason}</div>}
            {Array.isArray(ref.evidence) && ref.evidence.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {(ref.evidence as string[]).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="mt-1 text-muted">
              Rule: {String(ref.rule ?? "n/a")} · As of {String(ref.asOf ?? "n/a")}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!t.title.trim()}>
            {t.id ? "Save task" : "Create task"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
