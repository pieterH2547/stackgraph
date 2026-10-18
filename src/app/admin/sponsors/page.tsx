import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SponsorForm } from "@/components/admin/SponsorForms";
import { createSponsorAction } from "@/actions/sponsors";
import { emptyStats, getSponsorStats, listSponsors } from "@/lib/db/sponsors";
import { padCount, percent } from "@/lib/format";
import { routes } from "@/lib/routes";
import { isAdmin } from "@/lib/session";
import {
  SPONSOR_PACKAGES,
  sponsorStatus,
  type SponsorStatus,
} from "@/lib/sponsors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · sponsors",
  robots: { index: false, follow: false },
};

const STATUS_CLASS: Record<SponsorStatus, string> = {
  LIVE: "text-accent-ink",
  SCHEDULED: "text-ink-2",
  ENDED: "text-ink-3",
  INACTIVE: "text-ink-3",
};

export default async function AdminSponsorsPage() {
  if (!(await isAdmin())) redirect("/admin");

  const [sponsors, stats] = await Promise.all([
    listSponsors(),
    getSponsorStats(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <p className="mono text-ink-3">
        <Link href="/admin" className="hover:text-accent-ink">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Sponsors</h1>
      <p className="mt-3 max-w-xl text-ink-2">
        A sponsor buys one labelled card beside company profiles. It buys no
        relationship, no claim and no place in any ordering — nothing on this
        page can reach the graph.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="label !mb-0 py-2">Sponsor</th>
              <th className="label !mb-0 py-2">Status</th>
              <th className="label !mb-0 py-2">Package</th>
              <th className="label !mb-0 py-2">Window</th>
              <th className="label !mb-0 py-2 text-right">Impressions</th>
              <th className="label !mb-0 py-2 text-right">Clicks</th>
              <th className="label !mb-0 py-2 text-right">CTR</th>
            </tr>
          </thead>
          <tbody>
            {sponsors.map((sponsor) => {
              const s = stats.get(sponsor.id) ?? emptyStats(sponsor.id);
              const status = sponsorStatus(sponsor);
              return (
                <tr key={sponsor.id} className="border-b border-line">
                  <td className="py-2.5 pr-4">
                    <Link
                      href={routes.adminSponsor(sponsor.id)}
                      className="font-medium hover:text-accent-ink"
                    >
                      {sponsor.name}
                    </Link>
                    <span className="mono block max-w-[18rem] truncate text-ink-3">
                      {sponsor.categories
                        ? sponsor.categories.join(", ")
                        : "every profile"}
                    </span>
                  </td>
                  <td className={`mono py-2.5 pr-4 ${STATUS_CLASS[status]}`}>
                    {status}
                  </td>
                  <td className="mono py-2.5 pr-4 text-ink-3">
                    {SPONSOR_PACKAGES[sponsor.package]?.label ?? sponsor.package}
                  </td>
                  <td className="mono py-2.5 pr-4 text-ink-3">
                    {sponsor.startsOn ?? "…"} → {sponsor.endsOn ?? "…"}
                  </td>
                  <td className="mono py-2.5 pr-4 text-right">
                    {padCount(s.impressions)}
                    <span className="text-ink-3"> / {padCount(s.impressionsRaw)}</span>
                  </td>
                  <td className="mono py-2.5 pr-4 text-right">
                    {padCount(s.clicks)}
                    <span className="text-ink-3"> / {padCount(s.clicksRaw)}</span>
                  </td>
                  <td className="mono py-2.5 text-right">{percent(s.ctr, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sponsors.length === 0 ? (
        <p className="mt-6 text-ink-2">No sponsors yet.</p>
      ) : (
        <p className="mono mt-3 max-w-2xl leading-relaxed text-ink-3">
          Counts read filtered / raw. Raw is every beacon that reached the
          server. Filtered drops known crawlers and repeats from the same
          browser on the same day, and CTR is clicks over impressions on the
          filtered numbers. No cookie is set and no IP or user agent is
          stored.
        </p>
      )}

      <section className="mt-12">
        <h2 className="label">New sponsor</h2>
        <SponsorForm action={createSponsorAction} submitLabel="Create" />
      </section>
    </main>
  );
}
