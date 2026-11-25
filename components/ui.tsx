"use client";

import { Info, Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import type { FlagLevel } from "@/lib/engine";

export function Card({ title, help, right, children, className = "" }: { title?: ReactNode; help?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            {title}
            {help && <Tip text={help} />}
          </h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex cursor-help align-middle" tabIndex={0} aria-label={text}>
      <Info className="h-3.5 w-3.5 text-muted" />
      <span className="pointer-events-none absolute left-1/2 top-5 z-50 hidden w-72 -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-[12px] font-normal leading-snug text-white shadow-lg group-hover:block group-focus:block">
        {text}
      </span>
    </span>
  );
}

export function Badge({ kind, children }: { kind: "sourced" | "assumption" | "projected" | "neutral" | "app"; children?: ReactNode }) {
  const map = {
    sourced: "bg-good-soft text-good",
    assumption: "bg-warn-soft text-warn",
    projected: "bg-brand-soft text-brand",
    neutral: "bg-slate-100 text-slate-600",
    app: "bg-violet-50 text-violet-700",
  } as const;
  const label = { sourced: "SOURCED", assumption: "ASSUMPTION", projected: "PROJECTED", neutral: "", app: "APP DATA" }[kind];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${map[kind]}`}>{children ?? label}</span>;
}

export function FlagChip({ level, title }: { level: FlagLevel; title?: string }) {
  const map = { scale: "bg-good-soft text-good border-green-200", watch: "bg-warn-soft text-warn border-amber-200", stop: "bg-bad-soft text-bad border-red-200" } as const;
  return (
    <span title={title} className={`inline-flex cursor-default items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${map[level]}`}>
      {level}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line p-6 text-center text-muted">{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const v = {
    default: "border border-line bg-white hover:bg-slate-50 text-ink",
    primary: "bg-brand text-white hover:opacity-90",
    danger: "bg-bad text-white hover:opacity-90",
    ghost: "text-muted hover:bg-slate-100",
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium disabled:opacity-50 ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-[10vh]" onClick={onClose}>
      <div className={`w-full ${width} rounded-lg border border-line bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px]";

export function Caveats({ items, basis }: { items: string[]; basis?: string[] }) {
  if (!items.length && !basis?.length) return null;
  return (
    <details className="mt-3 text-[12px] text-muted">
      <summary className="cursor-pointer select-none">How this is calculated{items.length ? ` (${items.length} caveat${items.length > 1 ? "s" : ""})` : ""}</summary>
      {basis && basis.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {basis.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-warn">
          {items.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
