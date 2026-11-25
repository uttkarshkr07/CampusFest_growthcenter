"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, CircleDot, LogIn, Mail, UserPlus, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { person, type TimelineItem } from "@/lib/engine";
import { Badge, Card, Caveats, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

const ICON: Record<TimelineItem["kind"], typeof CircleDot> = {
  first_seen: UserPlus,
  interaction: Mail,
  registration: LogIn,
  status: CircleDot,
  checkin: CheckCircle2,
};

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const personId = decodeURIComponent(id);
  const { data, asOf } = useStore();
  const res = useMemo(() => (data ? person(data, personId, asOf) : null), [data, personId, asOf]);
  if (!res) return null;
  const v = res.value;
  if (!v)
    return (
      <div className="space-y-4">
        <PageHeader title={personId} />
        <Empty>{res.caveats.join(" ")}</Empty>
      </div>
    );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${v.profile.person_name}`}
        subtitle={
          <>
            <span className="font-mono">{v.profile.person_id}</span> · {v.profile.person_type} · first touch: {v.profile.first_touch_source ?? "unknown"} · <Link className="text-brand" href="/people">back to People</Link>
          </>
        }
        right={
          <div className="flex gap-2">
            {v.attended ? <Badge kind="sourced">ACTUAL ATTENDEE</Badge> : <Badge kind="neutral">DID NOT ATTEND (AS OF {asOf})</Badge>}
            {v.walkIn && <Badge kind="assumption">WALK-IN</Badge>}
            {v.engaged && <Badge kind="projected">ASKED A QUESTION</Badge>}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="space-y-1.5 text-[13px]">
            {[
              ["First seen", fmtDateTime(v.profile.first_seen_at)],
              ["First campaign", v.profile.first_campaign_name ? `${v.profile.first_campaign_name} (${v.profile.first_campaign_id})` : "none"],
              ["Owner", v.profile.owner_name ?? "none"],
              ...v.registrations.map((r) => [`Registration ${r.registration_id}`, `${r.status ?? "no status"} · ${r.campaign_id ?? "no campaign"}`]),
            ].map(([k, val]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right">{val}</dd>
              </div>
            ))}
          </dl>
          <Caveats items={res.caveats} basis={res.basis} />
        </Card>
        <Card className="lg:col-span-2" title={`Timeline (${v.timeline.length} events up to ${asOf})`}>
          <ol className="relative space-y-3 border-l border-line pl-5">
            {v.timeline.map((t, i) => {
              const Icon = t.kind === "checkin" && t.counts === false ? XCircle : ICON[t.kind];
              const color = t.kind === "checkin" ? (t.counts ? "text-good" : "text-bad") : t.kind === "status" ? "text-brand" : "text-muted";
              return (
                <li key={i} className="relative">
                  <Icon className={`absolute -left-[27px] top-0.5 h-4 w-4 bg-white ${color}`} />
                  <div className="text-[13px] font-medium capitalize">{t.title}</div>
                  <div className="text-[12px] text-muted">
                    {fmtDateTime(t.at)}
                    {t.campaign_id ? ` · ${t.campaign_id}` : ""}
                    {t.detail ? ` · ${t.detail}` : ""}
                    {t.kind === "checkin" && (t.counts ? " · counts toward attendance" : " · does not count")}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
