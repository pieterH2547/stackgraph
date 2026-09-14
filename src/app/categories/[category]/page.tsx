import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyCard } from "@/components/CompanyCard";
import { SiteSearch } from "@/components/SiteSearch";
import { brand } from "@/lib/brand";
import { listCompaniesInCategory } from "@/lib/db/queries";
import { companiesCount } from "@/lib/format";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/categories/[category]">): Promise<Metadata> {
  const { category } = await params;
  const name = decodeURIComponent(category);
  return {
    title: name,
    description: `Independent ${name.toLowerCase()} software on ${brand.name}, and who uses it.`,
  };
}

/**
 * One category. Ordered by connections, because that is the only thing here
 * worth ordering on — and it is a count of what companies said about
 * themselves, not a score we assigned.
 */
export default async function CategoryPage({
  params,
}: PageProps<"/categories/[category]">) {
  const { category } = await params;
  const name = decodeURIComponent(category);
  const companies = await listCompaniesInCategory(name);

  if (companies.length === 0) notFound();

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="mono text-ink-3">
        <Link href={routes.categories()} className="hover:text-accent-ink">
          Categories
        </Link>
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4.5vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.035em]">
        {name}
      </h1>
      <p className="mt-3 leading-relaxed text-ink-2">
        {companiesCount(companies.length)}, most connected first.
      </p>

      <div className="mt-7 max-w-xl">
        <SiteSearch />
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => (
          <CompanyCard
            key={company.id}
            company={company}
            usedBy={company.incoming}
          />
        ))}
      </div>
    </main>
  );
}
