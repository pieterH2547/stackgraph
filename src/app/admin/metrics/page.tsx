import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { decimal, padCount, percent } from "@/lib/format";
import { getFlywheelMetrics } from "@/lib/metrics";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Flywheel metrics",
  robots: { index: false, follow: false },
};

export default async function MetricsPage() {
  if (!(await isAdmin())) redirect("/admin");

  const m = await getFlywheelMetrics();

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <p className="mono text-ink-3">
        <Link href="/admin" className="hover:text-accent-ink">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">
        Does one vendor cause another to join?
      </h1>
      <p className="mt-3 max-w-xl text-ink-2">
        The only question this MVP exists to answer. Profile count is not on
        this page on purpose — a node without edges is worth almost nothing.
      </p>

      {/* K, with its four factors spelled out. */}
      <section className="card mt-8 p-6 sm:p-8">
        <p className="label">Effective K-factor</p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <span className="text-[clamp(3rem,10vw,5rem)] font-medium leading-none tracking-[-0.04em]">
            {decimal(m.kFactor, 2)}
          </span>
          <span
            className={`mono ${m.selfSustaining ? "text-accent-ink" : "text-ink-3"}`}
          >
            {m.selfSustaining
              ? "K ≥ 1 · the network grows itself"
              : "K < 1 · not self-sustaining yet"}
          </span>
        </div>
        <p className="mono mt-5 border-t border-line pt-4 leading-relaxed text-ink-2">
          {decimal(m.edgesPerClaimedVendor, 2)} edges per claimed vendor ×{" "}
          {percent(m.contactableRate, 0)} contactable ×{" "}
          {percent(m.notificationToClaimRate, 0)} notification → claim ×{" "}
          {percent(m.claimToContributionRate, 0)} claim → contribution ={" "}
          <span className="text-ink">{decimal(m.kFactor, 2)}</span>
        </p>
      </section>

      {/* Cycle time: K means nothing without it. */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <Metric
          label="Viral cycle time (median)"
          value={
            m.medianCycleHours === null
              ? "—"
              : m.medianCycleHours < 48
                ? `${decimal(m.medianCycleHours, 1)}h`
                : `${decimal(m.medianCycleHours / 24, 1)}d`
          }
          note="Invitation sent → claim completed. K = 1.2 per day is a business; per two months is a hobby."
        />
        <Metric
          label="Fastest generation"
          value={
            m.fastestCycleHours === null
              ? "—"
              : `${decimal(m.fastestCycleHours, 1)}h`
          }
          note="The best this loop has managed from recognition to a finished claim."
        />
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Edges per claimed vendor"
          value={decimal(m.edgesPerClaimedVendor, 2)}
          note={`${m.edges.acquisition} acquisition · ${m.edges.proof} proof · ${m.edges.stackOnly} stack-only`}
        />
        <Metric
          label="Contactable"
          value={percent(m.contactableRate, 0)}
          note={`${m.funnel.contactable} of ${m.funnel.vendorsIdentified} identified vendors have a contact route`}
        />
        <Metric
          label="Notification → claim"
          value={percent(m.notificationToClaimRate, 0)}
          note={`Of ${m.funnel.notificationsDelivered} vendors we reached`}
        />
        <Metric
          label="Claim → contribution"
          value={percent(m.claimToContributionRate, 0)}
          note={`${m.funnel.claimsCompleted} of ${m.funnel.claimsVerified} verified vendors credited ${m.requiredUpstream} independent tools`}
        />
      </div>

      <section className="mt-12">
        <h2 className="label">The funnel</h2>
        <ul className="max-w-lg">
          <FunnelStep
            label="Vendors identified"
            value={m.funnel.vendorsIdentified}
            of={m.funnel.vendorsIdentified}
          />
          <FunnelStep
            label="Contactable"
            value={m.funnel.contactable}
            of={m.funnel.vendorsIdentified}
          />
          <FunnelStep
            label="Notification delivered"
            value={m.funnel.notificationsDelivered}
            of={m.funnel.vendorsIdentified}
          />
          <FunnelStep
            label="Claim clicked"
            value={m.funnel.claimsClicked}
            of={m.funnel.vendorsIdentified}
          />
          <FunnelStep
            label="Identity verified"
            value={m.funnel.claimsVerified}
            of={m.funnel.vendorsIdentified}
          />
          <FunnelStep
            label="Claim completed"
            value={m.funnel.claimsCompleted}
            of={m.funnel.vendorsIdentified}
          />
          <FunnelStep
            label="Contributed next edges"
            value={m.funnel.contributedNextEdges}
            of={m.funnel.vendorsIdentified}
          />
        </ul>
        {m.pendingClaims > 0 && (
          <p className="mono mt-3 text-ink-3">
            {m.pendingClaims} verified{" "}
            {m.pendingClaims === 1 ? "vendor is" : "vendors are"} stuck
            mid-claim — they confirmed an email but haven’t finished both halves.
          </p>
        )}
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="label">Generations</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label !mb-0 py-2">Generation</th>
                <th className="label !mb-0 py-2">Companies</th>
                <th className="label !mb-0 py-2">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {m.generations.map((row) => (
                <tr key={row.generation} className="border-b border-line">
                  <td className="mono py-2">
                    {row.generation === 0
                      ? "0 · seeds & signups"
                      : row.generation}
                  </td>
                  <td className="mono py-2">{row.total}</td>
                  <td className="mono py-2">{row.claimed}</td>
                </tr>
              ))}
              {m.generations.length === 0 && (
                <tr>
                  <td className="py-3 text-ink-3" colSpan={3}>
                    No companies yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mono mt-3 text-ink-3">
            Deepest claimed generation:{" "}
            <span className="text-ink">{m.deepestClaimedGeneration}</span>
            {m.deepestClaimedGeneration >= 2
              ? " · third generation is claiming, the thesis is holding"
              : m.deepestClaimedGeneration === 1
                ? " · second generation is claiming"
                : " · only seeds and self-serve signups so far"}
          </p>
          <p className="mono mt-1 text-ink-3">
            {m.seedVendors} seeded by hand · {m.incumbentsInGraph} incumbents in
            the graph · {m.disputedEdges} disputed edges
          </p>
        </section>

        <section>
          <h2 className="label">Events</h2>
          <ul className="grid gap-1.5">
            {Object.entries(m.events).map(([name, count]) => (
              <li
                key={name}
                className="mono flex justify-between border-b border-line py-1.5 text-ink-3"
              >
                <span>{name.replace(/_/g, " ")}</span>
                <span className="text-ink">{padCount(count)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="card p-5">
      <p className="label">{label}</p>
      <p className="text-3xl font-medium tracking-tight">{value}</p>
      <p className="mt-2 text-sm leading-snug text-ink-3">{note}</p>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  of,
}: {
  label: string;
  value: number;
  of: number;
}) {
  const width = of === 0 ? 0 : Math.round((value / of) * 100);
  return (
    <li className="border-b border-line py-2">
      <div className="mono flex items-baseline justify-between gap-3 text-ink-3">
        <span>{label}</span>
        <span className="text-ink">{padCount(value)}</span>
      </div>
      <div className="mt-1.5 h-1 w-full rounded-full bg-line">
        <div
          className="h-1 rounded-full bg-accent"
          style={{ width: `${Math.max(width, value > 0 ? 3 : 0)}%` }}
        />
      </div>
    </li>
  );
}
