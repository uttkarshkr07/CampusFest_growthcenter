// Indian number formatting and IST date display. No em dashes anywhere in UI copy.

export function inr(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  if (opts.compact && Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(Math.abs(n) >= 1000000 ? 1 : 2).replace(/\.?0+$/, "")}L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return Math.round(n).toLocaleString("en-IN");
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n.toFixed(digits).replace(/\.0$/, "")}%`;
}

const IST = "Asia/Kolkata";

export function fmtDate(iso: string | number | null | undefined): string {
  if (iso == null || iso === "") return "n/a";
  const d = typeof iso === "number" ? new Date(iso) : new Date(String(iso).length === 10 ? `${iso}T12:00:00+05:30` : String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (iso == null || iso === "") return "n/a";
  const d = new Date(typeof iso === "number" ? iso : String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", { timeZone: IST, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
}
