"use client";

import { useEffect, useMemo, useState } from "react";
import { dataQuality, viewAsOf, type Effect, type Issue } from "@/lib/engine";
import { fmtDate, num } from "@/lib/format";
import { useSponsor } from "@/lib/sponsor/store";
import { useStore } from "@/lib/store";
import { Button, Empty, Spinner } from "./ui";

const EFFECT: Record<Effect, { label: string; style: string }> = {
  excluded: { label: "Left out", style: "bg-bad-soft text-bad" },
  check: { label: "Check", style: "bg-warn-soft text-warn" },
  read_as: { label: "Read as tidied", style: "bg-brand-soft text-brand" },
  info: { label: "Expected by the rules", style: "bg-subtle-2 text-muted" },
};
const PAGE = 20;

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // a leading =, +, - or @ would be run as a formula when the file is opened in a spreadsheet
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

function download(issues: Issue[], asOf: string) {
  const lines = [["Table", "Problem", "What the app does", "Record ID", "Detail"].map(csvCell).join(",")];
  for (const i of issues) for (const r of i.records) lines.push([i.table, i.title, i.rule, r.id, r.detail].map(csvCell).join(","));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `data-quality-${asOf}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DataQuality() {
  const { data, asOf } = useStore();
  const { data: sponsor, status, load } = useSponsor();
  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);
  const waiting = status === "idle" || status === "loading";
  const issues = useMemo(() => (data && !waiting ? dataQuality(viewAsOf(data, asOf), sponsor) : null), [data, asOf, sponsor, waiting]);
  if (!issues) return <Spinner label="Checking every record..." />;
  const total = issues.reduce((a, i) => a + i.records.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-[13px] text-muted">
          Records dated up to {fmtDate(asOf)}, plus records with no readable date. Nothing is changed or guessed: each problem says what the app does with it.
          {!sponsor && " Sponsor records could not be loaded, so they are not checked."}
        </p>
        <Button onClick={() => download(issues, asOf)} disabled={!total}>
          Download all {num(total)} as CSV
        </Button>
      </div>
      {issues.length === 0 ? <Empty>No problems found in these records.</Empty> : issues.map((i) => <IssueRow key={`${i.table}:${i.code}`} issue={i} />)}
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const pages = Math.max(1, Math.ceil(issue.records.length / PAGE));
  const at = Math.min(page, pages);
  return (
    <div className="rounded-md border border-line">
      <button className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-subtle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${EFFECT[issue.effect].style}`}>{EFFECT[issue.effect].label}</span>
        <span className="text-[13px] font-semibold">{issue.title}</span>
        <span className="text-[12px] text-muted">in {issue.table.replace(/_/g, " ")}</span>
        <span className="tabular ml-auto text-[13px]">{num(issue.records.length)} records</span>
        <span className="w-full text-[12px] text-muted">{issue.rule}</span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          <table className="w-full text-[12px]">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Record</th>
                <th className="py-1 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {issue.records.slice((at - 1) * PAGE, at * PAGE).map((r, n) => (
                <tr key={`${r.id}-${n}`} className="border-t border-line/60 align-top">
                  <td className="py-1 pr-3 font-mono">{r.id}</td>
                  <td className="py-1">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-end gap-2 text-[12px]">
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
        </div>
      )}
    </div>
  );
}
