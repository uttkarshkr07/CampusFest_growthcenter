"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge, Button, Card, Caveats, Empty, Modal, PageHeader, Spinner, inputCls } from "@/components/ui";
import { QUALIFICATIONS, STAGES, sponsorActivations, sponsorBrand, sponsorBrands, sponsorCampaigns, sponsorOpportunities, sponsorOverview, type SponsorData } from "@/lib/engine/sponsor";
import { fmtDate, inr, num, pct } from "@/lib/format";
import { useSponsor } from "@/lib/sponsor/store";
import { useStore } from "@/lib/store";

const TABS = ["Overview", "Campaigns", "Opportunities", "Brands", "Activations"] as const;
type Tab = (typeof TABS)[number];

const label = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Table({ head, children, numeric = [] }: { head: string[]; children: React.ReactNode; numeric?: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="border-b border-line text-[12px] text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`whitespace-nowrap px-2 py-1.5 font-medium ${numeric.includes(i) ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const cell = "px-2 py-1.5";
const right = "tabular px-2 py-1.5 text-right";

export default function SponsorsPage() {
  const asOf = useStore((s) => s.asOf);
  const { data, status, error, load } = useSponsor();
  const [tab, setTab] = useState<Tab>("Overview");

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sponsors"
        subtitle={`Brand acquisition as of ${fmtDate(asOf)}. View only for every account. Sponsorship values are reported amounts, not cash received.`}
        right={<Badge kind="sourced" />}
      />
      {status === "idle" || status === "loading" ? (
        <Spinner label="Loading sponsor records..." />
      ) : status === "missing" ? (
        <Empty>Sponsor records have not been loaded into the database yet.</Empty>
      ) : status === "error" || !data ? (
        <div className="max-w-xl rounded-lg border border-red-200 bg-bad-soft p-4 text-bad">
          <div className="font-semibold">Could not load sponsor records</div>
          <div className="mt-1 text-[13px]">{error}</div>
          <Button className="mt-3" onClick={() => load()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${tab === t ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-ink"}`}>
                {t}
              </button>
            ))}
          </div>
          {tab === "Overview" && <Overview data={data} asOf={asOf} />}
          {tab === "Campaigns" && <Campaigns data={data} asOf={asOf} />}
          {tab === "Opportunities" && <Opportunities data={data} asOf={asOf} />}
          {tab === "Brands" && <Brands data={data} asOf={asOf} />}
          {tab === "Activations" && <Activations data={data} asOf={asOf} />}
        </>
      )}
    </div>
  );
}

function Overview({ data, asOf }: { data: SponsorData; asOf: string }) {
  const r = useMemo(() => sponsorOverview(data, asOf), [data, asOf]);
  const v = r.value;
  const populations: [string, number][] = [
    ["Brands on record", v.brands.onRecord],
    ["With any outreach, introduction or inbound", v.brands.withAnyTouch],
    ["Replied", v.brands.replied],
    ["Sent a positive reply", v.brands.withPositiveReply],
    ["Sent inbound interest", v.brands.sentInboundInterest],
    ["Had a meeting", v.brands.meetingHeld],
    ["Qualified now", v.brands.qualifiedNow],
    ["Have an opportunity", v.brands.withOpportunity],
    ["Have a confirmed partnership", v.brands.withConfirmedPartnership],
  ];
  const money: [string, number, string][] = [
    ["Reported confirmed value", v.reportedValue.confirmedInr, `${inr(v.reportedValue.confirmedCashTypeInr)} cash-type, ${inr(v.reportedValue.confirmedInKindInr)} in-kind. Not cash received.`],
    ["Proposed value in open opportunities", v.reportedValue.openProposedInr, "Estimates for deals not yet confirmed, lost or withdrawn."],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {v.targets.map((t) => (
          <Card key={t.label}>
            <div className="text-[12px] text-muted">{t.label}</div>
            <div className="tabular text-[22px] font-bold">{num(t.actual)}</div>
            <div className="text-[12px] text-muted">
              goal {t.goal == null ? "none yet" : num(t.goal)}
              {t.pctOfGoal != null && ` · ${pct(t.pctOfGoal)}`}
              {t.gap ? ` · ${num(t.gap)} to go` : ""}
            </div>
            {v.targetVersion && <div className="mt-1 text-[11px] text-muted">{v.targetVersion}</div>}
          </Card>
        ))}
        {money.map(([title, value, note]) => (
          <Card key={title}>
            <div className="text-[12px] text-muted">{title}</div>
            <div className="tabular text-[22px] font-bold">{inr(value)}</div>
            <div className="text-[12px] text-muted">{note}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Brand counts" help="Separate populations, not one funnel: a brand can appear in a later row without appearing in an earlier one.">
          <Table head={["Brands that...", "Count"]} numeric={[1]}>
            {populations.map(([name, n]) => (
              <tr key={name} className="border-b border-line/60">
                <td className={cell}>{name}</td>
                <td className={right}>{num(n)}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-[12px] text-muted">
            Activity: {num(v.activity.attempts)} outreach or inbound attempts, {num(v.activity.contactsInvolved)} contacts, {num(v.activity.events)} recorded events, {num(v.activity.contactsOptedOut)} contacts opted out.
          </p>
        </Card>
        <div className="space-y-4">
          <Card title="Opportunities by latest stage">
            <Table head={["Stage", "Opportunities", "Proposed value", "Confirmed value"]} numeric={[1, 2, 3]}>
              {v.stages.map((s) => (
                <tr key={s.stage} className="border-b border-line/60">
                  <td className={cell}>{label(s.stage)}</td>
                  <td className={right}>{num(s.opportunities)}</td>
                  <td className={right}>{inr(s.proposedValueInr)}</td>
                  <td className={right}>{s.stage === "partner_confirmed" ? inr(s.confirmedValueInr) : "not confirmed"}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Brand qualification now">
            <div className="flex flex-wrap gap-4 text-[13px]">
              {v.qualificationNow.map((q) => (
                <div key={q.status}>
                  <div className="tabular text-[18px] font-bold">{num(q.brands)}</div>
                  <div className="text-[12px] text-muted">{label(q.status)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <Card title="Import copies removed">
        <p className="text-[13px] text-slate-700">{v.dataQuality.map((d) => `${label(d.table)}: ${num(d.rows)} rows, ${num(d.unique)} unique`).join(" · ")}</p>
        <Caveats items={r.caveats} basis={r.basis} />
      </Card>
    </div>
  );
}

function Campaigns({ data, asOf }: { data: SponsorData; asOf: string }) {
  const r = useMemo(() => sponsorCampaigns(data, asOf), [data, asOf]);
  return (
    <Card title="Sponsor acquisition campaigns">
      <Table head={["Campaign", "Channel", "Owner", "Attempts", "Brands touched", "Replied", "Meeting held", "Qualified now", "Opportunities", "Confirmed", "Reported value"]} numeric={[3, 4, 5, 6, 7, 8, 9, 10]}>
        {r.value.rows.map((c) => (
          <tr key={c.id} className="border-b border-line/60">
            <td className={cell}>
              <span className="font-medium">{c.name}</span> <span className="text-[11px] text-muted">{c.id}</span>
            </td>
            <td className={cell}>{c.channel}</td>
            <td className={cell}>{c.owner}</td>
            <td className={right}>{num(c.attempts)}</td>
            <td className={right}>{num(c.brandsTouched)}</td>
            <td className={right}>{num(c.brandsReplied)}</td>
            <td className={right}>{num(c.brandsMeetingHeld)}</td>
            <td className={right}>{num(c.qualifiedBrands)}</td>
            <td className={right}>{num(c.opportunities)}</td>
            <td className={right}>{num(c.confirmedPartnerships)}</td>
            <td className={right}>{inr(c.reportedConfirmedInr)}</td>
          </tr>
        ))}
      </Table>
      <Caveats items={r.caveats} basis={r.basis} />
    </Card>
  );
}

function Opportunities({ data, asOf }: { data: SponsorData; asOf: string }) {
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const r = useMemo(() => sponsorOpportunities(data, asOf, { stage: stage || undefined, search }), [data, asOf, stage, search]);
  const [brand, setBrand] = useState<string | null>(null);
  return (
    <Card title={`Opportunities (${num(r.value.total)})`}>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search brand, owner or ID" />
        <select className="rounded-md border border-line bg-white px-2 py-1.5 text-[13px]" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </div>
      {r.value.rows.length === 0 ? (
        <Empty>No opportunities match at this date.</Empty>
      ) : (
        <Table head={["Brand", "Stage", "Support", "Proposed value", "Confirmed value", "Owner", "Source campaign", "Last update", "Days since"]} numeric={[3, 4, 8]}>
          {r.value.rows.map((o) => (
            <tr key={o.id} className="border-b border-line/60">
              <td className={cell}>
                <button className="text-left font-medium hover:text-brand" onClick={() => setBrand(o.brandId)}>
                  {o.brand}
                </button>{" "}
                <span className="text-[11px] text-muted">{o.id}</span>
              </td>
              <td className={cell}>{label(o.stage)}</td>
              <td className={cell}>{o.supportType === "in_kind" ? "In-kind" : "Cash"}</td>
              <td className={right}>{o.proposedValueInr == null ? "none" : inr(o.proposedValueInr)}</td>
              <td className={right}>{o.confirmedValueInr ? inr(o.confirmedValueInr) : "not confirmed"}</td>
              <td className={cell}>{o.owner}</td>
              <td className={cell}>{o.fromCampaign}</td>
              <td className={`${cell} whitespace-nowrap`}>{fmtDate(o.lastUpdate)}</td>
              <td className={right}>{num(o.daysSinceUpdate)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Caveats items={r.caveats} basis={r.basis} />
      <BrandDialog data={data} asOf={asOf} brandId={brand} onClose={() => setBrand(null)} />
    </Card>
  );
}

function Brands({ data, asOf }: { data: SponsorData; asOf: string }) {
  const [search, setSearch] = useState("");
  const [qualification, setQualification] = useState("");
  const [page, setPage] = useState(1);
  const [brand, setBrand] = useState<string | null>(null);
  const r = useMemo(() => sponsorBrands(data, asOf, { search, qualification: qualification || undefined }), [data, asOf, search, qualification]);
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(r.value.total / pageSize));
  const at = Math.min(page, pages);
  return (
    <Card title={`Brands (${num(r.value.total)})`}>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox
          value={search}
          onChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
          placeholder="Search brand, industry, owner or ID"
        />
        <select
          className="rounded-md border border-line bg-white px-2 py-1.5 text-[13px]"
          value={qualification}
          onChange={(e) => {
            setQualification(e.target.value);
            setPage(1);
          }}
          aria-label="Qualification"
        >
          <option value="">Any qualification</option>
          {QUALIFICATIONS.map((q) => (
            <option key={q} value={q}>
              {label(q)}
            </option>
          ))}
        </select>
      </div>
      {r.value.total === 0 ? (
        <Empty>No brands match at this date.</Empty>
      ) : (
        <Table head={["Brand", "Industry", "Owner", "Qualification", "Contacts", "Attempts", "Replied", "Opportunity stage", "Last activity"]} numeric={[4, 5]}>
          {r.value.rows.slice((at - 1) * pageSize, at * pageSize).map((b) => (
            <tr key={b.id} className="border-b border-line/60">
              <td className={cell}>
                <button className="text-left font-medium hover:text-brand" onClick={() => setBrand(b.id)}>
                  {b.brand}
                </button>{" "}
                <span className="text-[11px] text-muted">{b.id}</span>
              </td>
              <td className={cell}>{b.industry}</td>
              <td className={cell}>{b.owner}</td>
              <td className={cell}>{b.qualification ? label(b.qualification) : "none"}</td>
              <td className={right}>{num(b.contacts)}</td>
              <td className={right}>{num(b.attempts)}</td>
              <td className={cell}>{b.replied ? "yes" : "no"}</td>
              <td className={cell}>{b.stages.length ? b.stages.map(label).join(", ") : "none"}</td>
              <td className={`${cell} whitespace-nowrap`}>{b.lastActivity ? fmtDate(b.lastActivity) : "none"}</td>
            </tr>
          ))}
        </Table>
      )}
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
      <Caveats items={r.caveats} basis={r.basis} />
      <BrandDialog data={data} asOf={asOf} brandId={brand} onClose={() => setBrand(null)} />
    </Card>
  );
}

function BrandDialog({ data, asOf, brandId, onClose }: { data: SponsorData; asOf: string; brandId: string | null; onClose: () => void }) {
  const r = useMemo(() => (brandId ? sponsorBrand(data, asOf, brandId) : null), [data, asOf, brandId]);
  const v = r?.value;
  return (
    <Modal open={!!v} onClose={onClose} title={v ? `${v.brand.name} (${v.brand.id})` : "Brand"} width="max-w-3xl">
      {v && (
        <div className="max-h-[65vh] space-y-3 overflow-y-auto text-[13px]">
          <p>
            {v.brand.industry} · owner {v.brand.owner} · qualification now: {v.qualification ? label(v.qualification) : "none"}
          </p>
          <p>
            <span className="font-semibold">Contacts:</span> {v.contacts.map((c) => `${c.name} (${c.title})`).join("; ") || "none"}
          </p>
          {v.opportunities.length > 0 && (
            <p>
              <span className="font-semibold">Opportunities:</span> {v.opportunities.map((o) => `${o.id}, ${o.stage ? label(o.stage) : "no stage"}`).join("; ")}
            </p>
          )}
          <Table head={["Date", "Record", "What happened", "Who", "Note"]}>
            {v.timeline.map((t, i) => (
              <tr key={i} className="border-b border-line/60 align-top">
                <td className={`${cell} whitespace-nowrap`}>{fmtDate(t.at)}</td>
                <td className={cell}>{label(t.kind)}</td>
                <td className={cell}>{label(t.what)}</td>
                <td className={cell}>{t.who}</td>
                <td className={`${cell} text-muted`}>{t.note}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Modal>
  );
}

function Activations({ data, asOf }: { data: SponsorData; asOf: string }) {
  const r = useMemo(() => sponsorActivations(data, asOf), [data, asOf]);
  return (
    <Card title="Sponsor activations" help="A link from a sponsor opportunity to one attendee campaign.">
      {r.value.rows.length === 0 ? (
        <Empty>No activations were linked by this date.</Empty>
      ) : (
        <Table head={["Linked", "Brand", "Opportunity", "Attendee campaign", "Note"]}>
          {r.value.rows.map((a) => (
            <tr key={a.activation_id} className="border-b border-line/60 align-top">
              <td className={`${cell} whitespace-nowrap`}>{fmtDate(a.linked_at)}</td>
              <td className={`${cell} font-medium`}>{a.brand_name}</td>
              <td className={cell}>{a.opportunity_name}</td>
              <td className={cell}>
                {a.attendee_campaign_name} <span className="text-[11px] text-muted">{a.attendee_campaign_id}</span>
              </td>
              <td className={`${cell} text-muted`}>{a.activation_note}</td>
            </tr>
          ))}
        </Table>
      )}
      <Caveats items={r.caveats} basis={r.basis} />
    </Card>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-72">
      <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted" />
      <input className={`${inputCls} pl-8`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}
