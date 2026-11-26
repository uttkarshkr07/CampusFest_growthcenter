"use client";

import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/store";
import { ACCOUNTS, type Account } from "@/lib/auth/permissions";

function canDo(a: Account): string {
  if (a.reviewer) return "Can edit all data and tasks, and reset the demo.";
  const parts: string[] = [];
  if (a.teams.includes("publicity")) parts.push("campaigns, marketing spend, targets and settings");
  if (a.teams.includes("events")) parts.push("gate check-ins");
  parts.push(`${a.teams.join(" and ")} tasks`);
  return `Can edit ${parts.join("; ")}.`;
}

export default function Login() {
  const { signIn, busyKey, error } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-5">
      <div className="w-full max-w-2xl rounded-xl border border-line bg-white p-6 shadow-sm">
        <h1 className="text-[18px] font-bold">CampusFest Growth Center</h1>
        <p className="mt-1 text-[13px] text-slate-700">Choose who you are. Everyone can view everything; what you can change depends on the account. Chats with the copilot are kept per account.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {ACCOUNTS.map((a) => (
            <button
              key={a.key}
              onClick={() => signIn(a.key)}
              disabled={!!busyKey}
              className={`rounded-lg border p-3 text-left hover:bg-brand-soft disabled:opacity-60 ${a.reviewer ? "border-brand sm:col-span-2" : "border-line"}`}
            >
              <div className="flex items-center gap-2 text-[14px] font-semibold">
                {a.name}
                {busyKey === a.key && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </div>
              <div className="text-[12px] text-muted">{a.reviewer ? "For graders" : `Team: ${a.teams.join(", ")}`}</div>
              <div className="mt-1 text-[12px] text-slate-700">{canDo(a)}</div>
            </button>
          ))}
        </div>
        {error && <p className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
        <p className="mt-4 text-[11.5px] text-muted">
          Demo accounts for a fictional team, with placeholder email addresses. Anyone with this link can choose any of them, so do not enter personal or confidential information.
        </p>
      </div>
    </div>
  );
}
