import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  DeleteSponsorButton,
  SponsorForm,
} from "@/components/admin/SponsorForms";
import { removeSponsor, saveSponsor } from "@/actions/sponsors";
import {
  emptyStats,
  getSponsorById,
  getSponsorDailyStats,
  getSponsorStats,
} from "@/lib/db/sponsors";
import { padCount, percent, timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { isAdmin } from "@/lib/session";
import { SPONSOR_PACKAGES, sponsorStatus } from "@/lib/sponsors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · sponsor",
  robots: { index: false, follow: false },
};

export default async function AdminSponsorPage({
  params,
}: PageProps<"/admin/sponsors/[id]">) {
  if (!(await isAdmin())) redirect("/admin");

  const { id } = await params;
  const sponsor = await getSponsorById(id);
  if (!sponsor) notFound();

  const [allTime, recent, daily] = await Promise.all([
    getSponsorStats(),
    getSponsorStats({ days: 30 }),
    getSponsorDailyStats(sponsor.id, 30),
  ]);
  const total = allTime.get(sponsor.id) ?? emptyStats(sponsor.id);
  const month = recent.get(sponsor.id) ?? emptyStats(sponsor.id);
  const pkg = SPONSOR_PACKAGES[sponsor.package];

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <p className="mono text-ink-3">
        <Link href={routes.adminSponsors()} className="hover:text-accent-ink">
          ← Sponsors
        </Link>
      </p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">{sponsor.name}</h1>
      <p className="mono mt-2 text-ink-3">
        {sponsorStatus(sponsor)} · {pkg?.label ?? sponsor.package}
        {sponsor.monthlyPriceCents !== null &&
          ` · €${(sponsor.monthlyPriceCents / 100).toFixed(2)}/month`}{" "}
        · {sponsor.startsOn ?? "no start"} → {sponsor.endsOn ?? "no end"} ·
        updated {timeAgo(sponsor.updatedAt)}
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Impressions · 30 days"
          value={padCount(month.impressions)}
          note={`${padCount(month.impressionsRaw)} raw · ${padCount(total.impressions)} filtered all time`}
        />
        <Metric
          label="Clicks · 30 days"
          value={padCount(month.clicks)}
          note={`${padCount(month.clicksRaw)} raw · ${padCount(total.clicks)} filtered all time`}
        />
        <Metric
          label="CTR · 30 days"
          value={percent(month.ctr, 1)}
          note={`${percent(month.ctrRaw, 1)} on raw counts`}
        />
        <Metric
          label="CTR · all time"
          value={percent(total.ctr, 1)}
          note={`${percent(total.ctrRaw, 1)} on raw counts`}
        />
      </section>
      <p className="mono mt-3 max-w-2xl leading-relaxed text-ink-3">
        Filtered removes known crawlers and repeats from the same browser on
        the same day, recognised by a keyed hash that rotates daily. Raw is
        everything the beacon delivered. Visitors sending Global Privacy
        Control are counted once and never hashed.
      </p>

      <div className="mt-10">
        <SponsorForm
          action={saveSponsor.bind(null, sponsor.id)}
          sponsor={sponsor}
          submitLabel="Save"
        />
      </div>

      <section className="mt-12">
        <h2 className="label">By day · last 30 days</h2>
        <table className="w-full max-w-2xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="label !mb-0 py-2">Day</th>
              <th className="label !mb-0 py-2 text-right">Impressions</th>
              <th className="label !mb-0 py-2 text-right">Clicks</th>
              <th className="label !mb-0 py-2 text-right">CTR</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((row) => (
              <tr key={row.day} className="border-b border-line">
                <td className="mono py-2">{row.day}</td>
                <td className="mono py-2 text-right">
                  {padCount(row.impressions)}
                  <span className="text-ink-3"> / {padCount(row.impressionsRaw)}</span>
                </td>
                <td className="mono py-2 text-right">
                  {padCount(row.clicks)}
                  <span className="text-ink-3"> / {padCount(row.clicksRaw)}</span>
                </td>
                <td className="mono py-2 text-right">{percent(row.ctr, 1)}</td>
              </tr>
            ))}
            {daily.length === 0 && (
              <tr>
                <td className="py-3 text-ink-3" colSpan={4}>
                  Nothing recorded in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <DeleteSponsorButton
          action={removeSponsor.bind(null, sponsor.id)}
          name={sponsor.name}
        />
      </section>
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
