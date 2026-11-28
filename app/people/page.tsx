"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { peopleDirectory } from "@/lib/engine";
import { Button, Card, Empty, PageHeader } from "@/components/ui";
import { QueryParams } from "@/components/deeplink";
import { num } from "@/lib/format";

type Filters = { personType: string; campaignId: string; status: string; attended: "" | "yes" | "no"; engaged: "" | "yes" | "no" };
const NO_FILTERS: Filters = { personType: "", campaignId: "", status: "", attended: "", engaged: "" };
const STATUSES = ["interested", "confirmed", "cancelled", "waitlisted"];
const selectCls = "rounded-md border border-line bg-panel px-2 py-1.5 text-[13px]";

export default function PeoplePage() {
  const { data, asOf } = useStore();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const res = useMemo(
    () =>
      data
        ? peopleDirectory(data, asOf, {
            q,
            page,
            pageSize: 50,
            personType: f.personType || undefined,
            campaignId: f.campaignId || undefined,
            status: f.status || undefined,
            attended: f.attended || undefined,
            engaged: f.engaged || undefined,
          })
        : null,
    [data, asOf, q, page, f],
  );
  const types = useMemo(() => [...new Set((data?.people ?? []).map((x) => x.person_type).filter(Boolean))].sort(), [data]);
  if (!res || !data) return null;
  const set = (patch: Partial<Filters>) => {
    setF({ ...f, ...patch });
    setPage(1);
  };
  const anyFilter = q || Object.values(f).some(Boolean);
  const { total, rows, pageSize } = res.value;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* the campaign page links here as /people?campaign=<id> */}
      <QueryParams
        onParams={(p) => {
          const c = p.get("campaign");
          if (c) {
            setF({ ...NO_FILTERS, campaignId: c });
            setQ("");
            setPage(1);
          }
        }}
      />
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className={selectCls} value={f.personType} onChange={(e) => set({ personType: e.target.value })} aria-label="Person type">
            <option value="">Any type</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className={selectCls} value={f.campaignId} onChange={(e) => set({ campaignId: e.target.value })} aria-label="Registration campaign" title="The campaign the person registered through (the app's attribution rule)">
            <option value="">Any registration campaign</option>
            {data.campaigns.map((c) => (
              <option key={c.campaign_id} value={c.campaign_id}>
                {c.campaign_id} {c.campaign_name}
              </option>
            ))}
            <option value="none">Not registered</option>
          </select>
          <select className={selectCls} value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Latest status">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="none">not registered</option>
          </select>
          <select className={selectCls} value={f.attended} onChange={(e) => set({ attended: e.target.value as Filters["attended"] })} aria-label="Attended">
            <option value="">Attended: any</option>
            <option value="yes">Attended: yes</option>
            <option value="no">Attended: no</option>
          </select>
          <select className={selectCls} value={f.engaged} onChange={(e) => set({ engaged: e.target.value as Filters["engaged"] })} aria-label="Asked a question">
            <option value="">Asked a question: any</option>
            <option value="yes">Asked a question: yes</option>
            <option value="no">Asked a question: no</option>
          </select>
          {anyFilter && (
            <button
              className="text-[12px] text-brand hover:underline"
              onClick={() => {
                setF(NO_FILTERS);
                setQ("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <Empty>No people match these filters at this as-of date.</Empty>
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
                  <tr key={r.person_id} className="border-b border-line/60 hover:bg-subtle">
                    <td className="px-2 py-1.5 font-mono text-[12px]">
                      <Link className="text-brand hover:underline" href={`/people/${encodeURIComponent(r.person_id)}`}>
                        {r.person_id}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">{r.person_name}</td>
                    <td className={`px-2 py-1.5 ${r.person_type !== "external" ? "text-warn" : ""}`}>{r.person_type}</td>
                    <td className="px-2 py-1.5">{r.first_campaign_id ?? <span className="text-muted">none</span>}</td>
                    <td className="px-2 py-1.5">
                      {r.registration_campaign_id ? (
                        <Link className="hover:text-brand hover:underline" href={`/campaigns/${encodeURIComponent(r.registration_campaign_id)}`}>
                          {r.registration_campaign_id}
                        </Link>
                      ) : (
                        <span className="text-muted">none</span>
                      )}
                    </td>
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
