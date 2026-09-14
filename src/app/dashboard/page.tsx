import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CompanyLogo } from "@/components/CompanyLogo";
import { getCompanyById } from "@/lib/db/queries";
import { routes } from "@/lib/routes";
import { currentUser } from "@/lib/auth/session";
import { listMemberships } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your companies",
  robots: { index: false },
};

/**
 * Where a returning owner lands. The point of this page is that it exists at
 * all: ownership is a row, so signing in on a new machine finds the same
 * companies instead of asking anyone to claim them again.
 */
export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect(routes.signIn());

  const memberships = await listMemberships(user.id);
  const companies = (
    await Promise.all(memberships.map((m) => getCompanyById(m.companyId)))
  ).flatMap((company) => (company ? [company] : []));

  // One company is the normal case, and a list of one is a pointless click.
  if (companies.length === 1) redirect(routes.manage(companies[0].slug));

  return (
    <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="mono text-ink-3">{user.email}</p>
      <h1 className="mt-3 text-[clamp(1.75rem,4.5vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.035em]">
        {companies.length === 0 ? "No company yet." : "Your companies."}
      </h1>

      {companies.length === 0 ? (
        <>
          <p className="mt-4 max-w-md leading-relaxed text-ink-2">
            Find your company and claim it — or add it if it isn’t here yet.
            Half the companies people look for already have a profile waiting.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={routes.add()} className="btn btn-primary">
              Claim your company
            </Link>
            <Link href={routes.network()} className="btn btn-secondary">
              Browse the network
            </Link>
          </div>
        </>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {companies.map((company) => (
            <li key={company.id} className="flex items-center gap-4 py-4">
              <CompanyLogo
                name={company.name}
                logoUrl={company.logoUrl}
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium tracking-tight">
                  {company.name}
                </span>
                <span className="mono block truncate text-ink-3">
                  {company.domain}
                </span>
              </span>
              <Link
                href={routes.manage(company.slug)}
                className="btn btn-secondary !py-2 !text-sm"
              >
                Manage
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
