import type { Metadata } from "next";
import Link from "next/link";
import { AdminLoginForm, SeedCompanyForm } from "@/components/admin/AdminForms";
import { StatusBadge } from "@/components/StatusBadge";
import { adminLogin, seedCompany } from "@/actions/admin";
import { getNetworkStats, listCompaniesWithCounts } from "@/lib/db/queries";
import { isAdmin } from "@/lib/session";
import { padCount, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  if (!(await isAdmin())) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <h1 className="text-3xl font-medium tracking-tight">Admin</h1>
        <AdminLoginForm action={adminLogin} />
      </main>
    );
  }

  const [companies, stats] = await Promise.all([
    listCompaniesWithCounts(),
    getNetworkStats(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-medium tracking-tight">Admin</h1>
        <Link href="/admin/metrics" className="btn btn-secondary !py-2 !text-sm">
          Flywheel metrics
        </Link>
      </div>

      <p className="mono mt-4 border-y border-line py-3 text-ink-3">
        <span className="text-ink">{padCount(stats.companies)}</span> companies ·{" "}
        <span className="text-ink">{padCount(stats.claimed)}</span> claimed ·{" "}
        <span className="text-ink">{padCount(stats.relationships)}</span>{" "}
        connections ·{" "}
        <span className="text-ink">{padCount(stats.eligible)}</span> eligible
      </p>

      <div className="mt-8">
        <SeedCompanyForm action={seedCompany} />
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="label !mb-0 py-2">Company</th>
              <th className="label !mb-0 py-2">Status</th>
              <th className="label !mb-0 py-2">Source</th>
              <th className="label !mb-0 py-2">Gen</th>
              <th className="label !mb-0 py-2">Uses</th>
              <th className="label !mb-0 py-2">Used by</th>
              <th className="label !mb-0 py-2">Elig.</th>
              <th className="label !mb-0 py-2">Added</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id} className="border-b border-line">
                <td className="py-2.5 pr-4">
                  <Link
                    href={`/admin/${company.id}`}
                    className="font-medium hover:text-accent-ink"
                  >
                    {company.name}
                  </Link>
                  <span className="mono block text-ink-3">
                    {company.domain}
                  </span>
                </td>
                <td className="py-2.5 pr-4">
                  <StatusBadge status={company.status} />
                </td>
                <td className="mono py-2.5 pr-4 text-ink-3">
                  {company.source}
                </td>
                <td className="mono py-2.5 pr-4 text-ink-3">
                  {company.generation}
                </td>
                <td className="mono py-2.5 pr-4">{company.outgoing}</td>
                <td className="mono py-2.5 pr-4">{company.incoming}</td>
                <td className="mono py-2.5 pr-4">
                  {company.networkEligible ? (
                    "YES"
                  ) : (
                    <span className="text-ink-3">NO</span>
                  )}
                </td>
                <td className="mono py-2.5 text-ink-3">
                  {timeAgo(company.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {companies.length === 0 && (
        <p className="mt-8 text-ink-2">
          Nothing seeded yet. Add the first real companies above.
        </p>
      )}
    </main>
  );
}
