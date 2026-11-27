// Turns the converter's rows into database rows: the listed columns only, each value in its type.
// Relative imports only: the load command runs this file outside the app.
import type { Kind } from "./bet-spec";

export interface Problem {
  sheet: string;
  row?: number;
  text: string;
}
export type Row = Record<string, unknown>;

export interface TableSpec {
  sheet: string;
  columns: Record<string, Kind>;
  /** the load stops when one of these is empty or unreadable */
  required: string[];
}

export const empty = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/** a real calendar date written as YYYY-MM-DD */
export function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export function isDateTime(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(v) && isDate(v.slice(0, 10)) && !Number.isNaN(Date.parse(v));
}
export const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
export const asBoolean = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  const word = typeof v === "string" ? v.trim().toLowerCase() : "";
  return word === "true" || word === "yes" ? true : word === "false" || word === "no" ? false : null;
};

export const rowNo = (r: Row) => (typeof r.__row === "number" ? r.__row : undefined);

export function convertTable(spec: TableSpec, source: Row[], errors: Problem[], warnings: Problem[]): Row[] {
  const emptied = new Map<string, { count: number; example: string; row?: number }>();
  const rows = source.map((r) => {
    const out: Row = {};
    for (const [column, kind] of Object.entries(spec.columns)) {
      const v = r[column] ?? null;
      let value: unknown = null;
      if (!empty(v)) {
        if (kind === "text") value = String(v);
        else if (kind === "number") value = asNumber(v);
        else if (kind === "boolean") value = asBoolean(v);
        else if (kind === "date") value = isDate(v) ? v : null;
        else value = isDateTime(v) ? v : null;
        if (value === null) {
          const e = emptied.get(column) ?? { count: 0, example: JSON.stringify(v), row: rowNo(r) };
          e.count++;
          emptied.set(column, e);
        }
      }
      if (value === null && spec.required.includes(column)) errors.push({ sheet: spec.sheet, row: rowNo(r), text: `${column} is ${empty(v) ? "empty" : `not readable: ${JSON.stringify(v)}`}, and it is required` });
      out[column] = value;
    }
    return out;
  });
  for (const [column, e] of emptied) warnings.push({ sheet: spec.sheet, row: e.row, text: `${e.count} value(s) in ${column} are not a readable ${spec.columns[column]} and will load as empty (first: ${e.example})` });
  return rows;
}
