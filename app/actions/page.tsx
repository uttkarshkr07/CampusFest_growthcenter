"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { actionList, actionMembers, COHORT_KEYS, COHORTS, viewAsOf, type Cohort } from "@/lib/engine";
import { Badge, Button, Card, Caveats, Empty, PageHeader } from "@/components/ui";
import TaskDialog, { blankTask, type TaskDraft } from "@/components/TaskDialog";
import { QueryParams } from "@/components/deeplink";
import { num, pct } from "@/lib/format";

const PAGE = 50;

export default function ActionsPage() {
  const { data, asOf } = useStore();
  const [cohort, setCohort] = useState<Cohort>(COHORT_KEYS[0]);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<TaskDraft | null>(null);

  useEffect(() => setPage(1), [cohort, asOf]);

  const res = useMemo(() => {
    if (!data) return null;
    const view = viewAsOf(data, asOf);
    return { summary: actionList(view, asOf), selected: actionList(view, asOf, cohort), members: actionMembers(view, asOf, cohort) };
  }, [data, asOf, cohort]);
  if (!data || !res) return null;
  const group = res.selected.value.groups[0];
  const post = res.summary.value.phase === "post-event";
  const pages = Math.max(1, Math.ceil(res.members.length / PAGE));

  const makeTask = () =>
    setDraft(
      blankTask(asOf, {
        title: `Follow up: ${group.label} (${group.count} people)`,
        description: `${group.definition} Full list: Actions screen, ${asOf}.`,
        origin: "rule",
        origin_ref: { rule: `Action list: ${group.label}`, asOf, reason: `${group.count} people are in this group as of ${asOf}.` },
      }),
    );

  return (
    <div className="space-y-4">
      <QueryParams
        onParams={(p) => {
          const wanted = p.get("cohort") as Cohort | null;
          if (wanted && COHORT_KEYS.includes(wanted)) setCohort(wanted);
        }}
      />
      <PageHeader title="Actions" subtitle="The people behind each funnel leak. Group sizes are not recoverable attendees." />
      <div className="grid gap-3 md:grid-cols-4">
        {res.summary.value.groups.map((g) => (
          <button key={g.cohort} onClick={() => setCohort(g.cohort)} className={`rounded-lg border p-3 text-left ${cohort === g.cohort ? "border-brand bg-brand-soft" : "border-line bg-white hover:bg-slate-50"}`}>
            <div className="text-[12px] text-muted">{g.label}</div>
            <div className="tabular text-2xl font-semibold">{num(g.count)}</div>
            {post && g.count > 0 && <div className="text-[11px] text-muted">{pct(g.laterShowUpPct)} attended in the end</div>}
          </button>
        ))}
      </div>
      <Card title={COHORTS[cohort].label} help={COHORTS[cohort].definition} right={<Button variant="primary" disabled={!group.count} onClick={makeTask}>+ Task for this group</Button>}>
        {group.count === 0 ? (
          <Empty>No one is in this group at this date.</Empty>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {group.byCampaign.map((c) => (
                <Badge key={c.campaign_id} kind="neutral">{c.campaign_name}: {c.count}</Badge>
              ))}
            </div>
            <table className="w-full text-[13px]">
              <thead className="border-b border-line text-left text-[12px] text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Person</th>
                  <th className="px-2 py-1.5 font-medium">Campaign</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium">Note</th>
                  {post && <th className="px-2 py-1.5 font-medium">Attended</th>}
                </tr>
              </thead>
              <tbody>
                {res.members.slice((page - 1) * PAGE, page * PAGE).map((m) => (
                  <tr key={m.person_id} className="border-b border-line/60">
                    <td className="px-2 py-1">
                      <Link className="text-brand hover:underline" href={`/people/${m.person_id}`}>{m.person_name}</Link> <span className="text-[11px] text-muted">{m.person_id}</span>
                    </td>
                    <td className="px-2 py-1">{m.campaign_id ?? "none"}</td>
                    <td className="px-2 py-1">{m.status ?? "no registration"}</td>
                    <td className="px-2 py-1 text-muted">{m.note ?? ""}</td>
                    {post && <td className="px-2 py-1">{m.attended ? "yes" : "no"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-center justify-end gap-2 text-[12px]">
              <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-muted">Page {page} of {pages}</span>
              <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </>
        )}
        <Caveats items={res.selected.caveats} basis={res.selected.basis} />
      </Card>
      <TaskDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
