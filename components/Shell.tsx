"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, Bot, Database, LayoutDashboard, ListChecks, RotateCcw, Settings, Users } from "lucide-react";
import { STORY, useStore } from "@/lib/store";
import { Button, Modal, Spinner } from "./ui";
import { fmtDate } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: BarChart3 },
  { href: "/people", label: "People", icon: Users },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/data", label: "Data", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { status, error, load, asOf, setAsOf, toast, notify, resetDemo, saving } = useStore();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (status === "idle") load();
  }, [status, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => notify(null), 3500);
    return () => clearTimeout(t);
  }, [toast, notify]);

  const quick = [
    { label: "Today in story", day: STORY.today, hint: "15 Mar 2025: revised targets take effect" },
    { label: "Event day 1", day: STORY.day1, hint: "12 Apr 2025" },
    { label: "Post-event", day: STORY.post, hint: "20 Apr 2025: final data" },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-line bg-white">
        <div className="border-b border-line px-4 py-3.5">
          <div className="text-[13px] font-bold leading-tight">CampusFest</div>
          <div className="text-[12px] text-muted">Growth Center</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] ${active ? "bg-brand-soft font-semibold text-brand" : "text-slate-700 hover:bg-slate-50"}`}>
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
          <div className="flex cursor-not-allowed items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-slate-400" title="The AI copilot is the next build step">
            <Bot className="h-4 w-4" /> Copilot (next)
          </div>
        </nav>
        <div className="border-t border-line p-3 text-[11px] leading-snug text-muted">Challenge A: maximise people who actually attend. Data: fictional CampusFest 2025.</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-line bg-white/95 px-5 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-muted">As of</span>
            <input
              type="date"
              min={STORY.min}
              max={STORY.max}
              value={asOf}
              onChange={(e) => e.target.value && setAsOf(e.target.value)}
              className="rounded-md border border-line px-2 py-1 text-[13px]"
              aria-label="As-of date"
            />
            <span className="hidden text-[12px] text-muted md:inline">end of {fmtDate(asOf)} IST</span>
          </div>
          <div className="flex gap-1">
            {quick.map((q) => (
              <button key={q.label} title={q.hint} onClick={() => setAsOf(q.day)} className={`rounded-md px-2 py-1 text-[12px] ${asOf === q.day ? "bg-brand text-white" : "border border-line hover:bg-slate-50"}`}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {saving && <span className="text-[12px] text-muted">Saving...</span>}
            <Button variant="ghost" onClick={() => setConfirmReset(true)} title="Restore the original dataset">
              <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-5">
          {status === "loading" || status === "idle" ? (
            <Spinner label="Loading the CampusFest dataset (about 25,000 rows)..." />
          ) : status === "error" ? (
            <div className="max-w-xl rounded-lg border border-red-200 bg-bad-soft p-4 text-bad">
              <div className="font-semibold">Could not load data</div>
              <div className="mt-1 text-[13px]">{error}</div>
              <Button className="mt-3" onClick={() => load()}>
                Retry
              </Button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset demo data?">
        <p className="text-[13px] text-slate-700">
          This restores every source table to the original CampusFest dataset and clears app-created campaigns, edits, tasks, settings changes and the change log. It cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirmReset(false);
              await resetDemo();
            }}
          >
            Reset everything
          </Button>
        </div>
      </Modal>

      {toast && <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md bg-ink px-4 py-2.5 text-[13px] text-white shadow-lg">{toast}</div>}
    </div>
  );
}
