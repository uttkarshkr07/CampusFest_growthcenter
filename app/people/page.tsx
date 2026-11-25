"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { peopleDirectory } from "@/lib/engine";
import { Button, Card, Empty, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";

export default function PeoplePage() {
  const { data, asOf } = useStore();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const res = useMemo(() => (data ? peopleDirectory(data, asOf, { q, page, pageSize: 50 }) : null), [data, asOf, q, page]);
  if (!res) return null;
  const { total, rows, pageSize } = res.value;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader title="People" subtitle={`${num(total)} people identified as of ${asOf}. Names repeat, so every person is keyed by person_id.`} />
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative w-80">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted" />
            <input
              className="w-full rounded-md border border-line py-1.5 pl-8 pr-2 text-[13px]"
              placeholder="Search name or person_id (e.g. E0002)"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <span className="text-[12px] text-muted">{num(total)} match(es)</span>
        </div>
        {rows.length === 0 ? (
          <Empty>No people match this search at this as-of date.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-line text-left text-[12px] text-muted">
                <tr>
                  <th className="px-2 py-2 font-medium">ID</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">First campaign</th>
                  <th className="px-2 py-2 font-medium">Registration campaign</th>
                  <th className="px-2 py-2 font-medium">Latest status</th>
                  <th className="px-2 py-2 font-medium">Attended</th>
                  <th className="px-2 py-2 font-medium">Asked a question</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.person_id} className="border-b border-line/60 hover:bg-slate-50">
                    <td className="px-2 py-1.5 font-mono text-[12px]">
                      <Link className="text-brand hover:underline" href={`/people/${encodeURIComponent(r.person_id)}`}>
                        {r.person_id}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">{r.person_name}</td>
                    <td className={`px-2 py-1.5 ${r.person_type !== "external" ? "text-warn" : ""}`}>{r.person_type}</td>
                    <td className="px-2 py-1.5">{r.first_campaign_id ?? <span className="text-muted">none</span>}</td>
                    <td className="px-2 py-1.5">{r.registration_campaign_id ?? <span className="text-muted">none</span>}</td>
                    <td className="px-2 py-1.5">{r.latest_status ?? <span className="text-muted">not registered</span>}</td>
                    <td className="px-2 py-1.5">{r.attended ? <span className="font-medium text-good">yes</span> : <span className="text-muted">no</span>}</td>
                    <td className="px-2 py-1.5">{r.engaged ? "yes" : <span className="text-muted">no</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-end gap-2 text-[12px]">
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
      </Card>
    </div>
  );
}
