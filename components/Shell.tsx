"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, Calculator, Database, Handshake, LayoutDashboard, Inbox, ListChecks, MessageSquare, RotateCcw, Settings, Target, Users } from "lucide-react";
import CopilotPanel from "./copilot/CopilotPanel";
import Login from "./Login";
import DatasetToggle from "./DatasetToggle";
import { DATASET_IDS, DATASET_LABEL } from "@/lib/datasets";
import { AUTH_ON } from "@/lib/auth/config";
import { useAuth } from "@/lib/auth/store";
import { useChat } from "@/lib/copilot/store";
import { useSponsor } from "@/lib/sponsor/store";
import { awaiting, TICKET_TEAMS, ticketsAt } from "@/lib/engine/tickets";
import { useStore } from "@/lib/store";
import { Button, Modal, Spinner } from "./ui";
import { fmtDate } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/copilot", label: "Copilot", icon: MessageSquare },
  { href: "/campaigns", label: "Campaigns", icon: BarChart3 },
  { href: "/actions", label: "Actions", icon: Target },
  { href: "/whatif", label: "What-if", icon: Calculator },
  { href: "/people", label: "People", icon: Users },
  { href: "/sponsors", label: "Sponsors", icon: Handshake },
  { href: "/tickets", label: "Tickets", icon: Inbox },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/data", label: "Data", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { status, error, load, asOf, setAsOf, toast, notify, resetDemo, saving, story, loadProgress, dataset } = useStore();
  const otherDataset = DATASET_IDS.find((d) => d !== dataset)!;
  const [confirmReset, setConfirmReset] = useState(false);

  const { status: authStatus, me, init: initAuth, signOut } = useAuth();
  const canReset = !me || me.isReviewer;
  const data = useStore((s) => s.data);
  const waiting = data ? awaiting(ticketsAt(data, asOf), !me || me.isReviewer ? TICKET_TEAMS : me.teams).length : 0;

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (authStatus === "ready" && status === "idle") load();
    if (authStatus === "signedOut") {
      useStore.getState().clear();
      useChat.getState().reset();
      useSponsor.getState().clear();
    }
  }, [authStatus, status, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => notify(null), 3500);
    return () => clearTimeout(t);
  }, [toast, notify]);

  const quick = story
    ? [
        { label: "Today in story", day: story.today, hint: `${fmtDate(story.today)}: the day the story treats as today` },
        { label: "Event day 1", day: story.day1, hint: fmtDate(story.day1) },
        { label: "Post-event", day: story.post, hint: `${fmtDate(story.post)}: final data` },
      ]
    : [];

  if (AUTH_ON && authStatus !== "ready") return authStatus === "checking" ? <div className="p-6"><Spinner label="Checking your sign-in..." /></div> : <Login />;

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
                {href === "/tickets" && waiting > 0 && (
                  <span className="ml-auto rounded-full bg-bad px-1.5 text-[11px] font-semibold text-white" title={`${waiting} waiting for an answer from ${me && !me.isReviewer ? "your team" : "a team"}`}>
                    {waiting}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-3 text-[11px] leading-snug text-muted">Challenge A: maximise people who actually attend. Data: fictional CampusFest 2025. Showing: {DATASET_LABEL[dataset]}.</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-line bg-white/95 px-5 py-2.5 backdrop-blur">
          <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={!canReset} title={canReset ? `Undo all changes to: ${DATASET_LABEL[dataset]}` : "Only the Reviewer account can reset the demo data"}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
          </Button>
          <DatasetToggle />
          {saving && <span className="text-[12px] text-muted">Saving...</span>}
          <div className="ml-auto flex gap-1">
            {quick.map((q) => (
              <button key={q.label} title={q.hint} onClick={() => setAsOf(q.day)} className={`rounded-md px-2 py-1 text-[12px] ${asOf === q.day ? "bg-brand text-white" : "border border-line hover:bg-slate-50"}`}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-muted">As of</span>
            <input
              type="date"
              min={story?.min}
              max={story?.max}
              value={asOf}
              onChange={(e) => e.target.value && setAsOf(e.target.value)}
              className="rounded-md border border-line px-2 py-1 text-[13px]"
              aria-label="As-of date"
            />
            <span className="hidden text-[12px] text-muted xl:inline">end of {fmtDate(asOf)} IST</span>
          </div>
          {me && (
            <div className="flex items-center gap-2 border-l border-line pl-3 text-[12px]">
              <div className="leading-tight">
                <div className="font-semibold">{me.name}</div>
                <div className="text-[11px] text-muted">{me.isReviewer ? "can edit everything" : me.teams.join(", ")}</div>
              </div>
              <button onClick={() => signOut()} className="rounded-md border border-line px-2 py-1 hover:bg-slate-50">
                Switch account
              </button>
            </div>
          )}
          {dataset === "simulated" && (
            <p className="order-last w-full rounded-md bg-warn-soft px-2 py-1 text-[12px] font-medium text-warn">SIMULATED: a made-up run of the fest with our bets. These are not real results.</p>
          )}
        </header>

        <main className="min-w-0 flex-1 p-5">
          {status === "loading" || status === "idle" ? (
            <Spinner label={loadProgress || "Loading the dataset..."} />
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

      <CopilotPanel />

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title={`Reset: ${DATASET_LABEL[dataset]}?`}>
        <p className="text-[13px] text-slate-700">
          This restores every table of the {DATASET_LABEL[dataset]} to the data as loaded, and clears its app-created campaigns, edits, tasks, settings changes and change log. Its tickets and comments go back to the loaded ones. {DATASET_LABEL[otherDataset]} is not touched. Copilot chats are kept. It cannot be undone.
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

      {toast && <div className="fixed bottom-20 left-56 z-50 max-w-sm rounded-md bg-ink px-4 py-2.5 text-[13px] text-white shadow-lg">{toast}</div>}
    </div>
  );
}
