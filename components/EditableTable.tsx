"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/store";
import { canEdit, whoCanEdit } from "@/lib/auth/permissions";
import { toIstIso, type SourceTable } from "@/lib/engine";
import { Badge, Button, Empty, Field, Modal, inputCls } from "./ui";

export interface ColSpec {
  key: string;
  label: string;
  type?: "text" | "number" | "datetime" | "date" | "select";
  options?: string[];
  editable?: boolean;
  required?: boolean;
  width?: string;
}

type Row = Record<string, unknown> & { _row_id?: number; _source?: string };

/** IST "YYYY-MM-DDTHH:MM" for a datetime-local input, from any ISO string. */
function toLocalInput(v: unknown): string {
  if (!v) return "";
  const ms = Date.parse(String(v));
  return Number.isNaN(ms) ? "" : toIstIso(ms).slice(0, 16);
}

function display(v: unknown, type?: ColSpec["type"]): string {
  if (v == null || v === "") return "";
  if (type === "datetime") return toLocalInput(v).replace("T", " ");
  if (type === "number") return Number(v).toLocaleString("en-IN");
  return String(v);
}

function parse(raw: string, type?: ColSpec["type"]): unknown {
  if (raw === "") return null;
  if (type === "number") return Number(raw);
  if (type === "datetime") return `${raw}:00+05:30`;
  return raw;
}

export default function EditableTable({
  table,
  idField,
  cols,
  searchKeys,
  filter,
  defaults,
  note,
  initialQuery = "",
}: {
  table: SourceTable;
  idField: string;
  cols: ColSpec[];
  searchKeys: string[];
  filter?: (r: Row) => boolean;
  defaults?: (rows: Row[]) => Record<string, unknown>;
  note?: string;
  /** a direct link starts the search on one item */
  initialQuery?: string;
}) {
  const { data, updateSourceRow, insertSourceRow } = useStore();
  const mayEdit = canEdit(useAuth((s) => s.me), table);
  const [q, setQ] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ row: number; key: string; value: string } | null>(null);
  const [adding, setAdding] = useState<Record<string, string> | null>(null);
  const all = (data?.[table] ?? []) as unknown as Row[];
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((r) => (!filter || filter(r)) && (!s || searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(s))));
  }, [all, q, filter, searchKeys]);
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shown = [...rows].reverse().slice((page - 1) * pageSize, page * pageSize); // newest rows first

  async function commit() {
    if (!editing) return;
    const row = all.find((r) => r._row_id === editing.row);
    const col = cols.find((c) => c.key === editing.key)!;
    setEditing(null);
    if (!row) return;
    const value = parse(editing.value, col.type);
    const oldRaw = col.type === "datetime" ? toLocalInput(row[col.key]) : String(row[col.key] ?? "");
    if (editing.value === oldRaw) return;
    await updateSourceRow(table, row._row_id!, { [col.key]: value }, String(row[idField] ?? row._row_id));
  }

  async function add() {
    if (!adding) return;
    const row: Record<string, unknown> = {};
    for (const c of cols) row[c.key] = parse(adding[c.key] ?? "", c.type);
    const ok = await insertSourceRow(table, row, String(row[idField] ?? "new"));
    if (ok) setAdding(null);
  }

  function openAdd() {
    const d = defaults?.(all) ?? {};
    const init: Record<string, string> = {};
    for (const c of cols) {
      const v = d[c.key];
      init[c.key] = v == null ? "" : c.type === "datetime" ? toLocalInput(v) : String(v);
    }
    setAdding(init);
  }

  if (!data) return null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted" />
          <input
            className="w-full rounded-md border border-line py-1.5 pl-8 pr-2 text-[13px]"
            placeholder={`Search ${searchKeys.join(", ")}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <span className="text-[12px] text-muted">{rows.length.toLocaleString("en-IN")} rows (raw, duplicates included)</span>
        <Button className="ml-auto" onClick={openAdd} disabled={!mayEdit} title={mayEdit ? undefined : whoCanEdit(table)}>
          <Plus className="h-4 w-4" /> Add row
        </Button>
      </div>
      {note && <p className="mb-2 text-[12px] text-muted">{note}</p>}
      {!mayEdit && <p className="mb-2 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">View only for you. {whoCanEdit(table)}</p>}
      {shown.length === 0 ? (
        <Empty>No rows.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {c.label}
                    {c.editable === false || !mayEdit ? "" : " ✎"}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r._row_id} className="border-b border-line/60">
                  {cols.map((c) => {
                    const isEdit = editing && editing.row === r._row_id && editing.key === c.key;
                    const editable = mayEdit && c.editable !== false;
                    return (
                      <td key={c.key} className={`whitespace-nowrap px-2 py-1 ${c.type === "number" ? "tabular text-right" : ""}`} style={{ width: c.width }}>
                        {isEdit ? (
                          c.type === "select" ? (
                            <select autoFocus className="rounded border border-brand px-1 py-0.5" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={commit}>
                              {c.options!.map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              autoFocus
                              type={c.type === "datetime" ? "datetime-local" : c.type === "date" ? "date" : c.type === "number" ? "number" : "text"}
                              className="w-full min-w-24 rounded border border-brand px-1 py-0.5"
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onBlur={commit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                          )
                        ) : (
                          <button
                            disabled={!editable}
                            className={`w-full rounded px-1 text-left ${c.type === "number" ? "text-right" : ""} ${editable ? "hover:bg-brand-soft" : "cursor-default"}`}
                            onClick={() => editable && setEditing({ row: r._row_id!, key: c.key, value: c.type === "datetime" ? toLocalInput(r[c.key]) : String(r[c.key] ?? "") })}
                          >
                            {display(r[c.key], c.type) || <span className="text-faint">empty</span>}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1">{r._source === "app" && <Badge kind="app">APP</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2 text-[12px]">
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span className="text-muted">
          Page {page} of {pages}
        </span>
        <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>

      <Modal open={!!adding} onClose={() => setAdding(null)} title={`Add a row to ${table}`} width="max-w-2xl">
        {adding && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {cols.map((c) => (
                <Field key={c.key} label={`${c.label}${c.required ? " *" : ""}`}>
                  {c.type === "select" ? (
                    <select className={inputCls} value={adding[c.key] ?? ""} onChange={(e) => setAdding({ ...adding, [c.key]: e.target.value })}>
                      <option value="">(empty)</option>
                      {c.options!.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputCls}
                      type={c.type === "datetime" ? "datetime-local" : c.type === "date" ? "date" : c.type === "number" ? "number" : "text"}
                      value={adding[c.key] ?? ""}
                      onChange={(e) => setAdding({ ...adding, [c.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
            <p className="text-[12px] text-muted">Times are IST. Reusing an existing ID with a different payload is allowed on purpose: the engine keeps the last version and raises a data-health warning.</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setAdding(null)}>Cancel</Button>
              <Button variant="primary" onClick={add} disabled={cols.some((c) => c.required && !adding[c.key])}>
                Add row
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
