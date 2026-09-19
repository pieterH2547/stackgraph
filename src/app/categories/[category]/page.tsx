import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyCard } from "@/components/CompanyCard";
import { CompanyLookup } from "@/components/CompanyLookup";
import { brand } from "@/lib/brand";
import {
  countCompaniesInCategory,
  listCompaniesInCategory,
} from "@/lib/db/queries";
import { companiesCount } from "@/lib/format";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

const PER_PAGE = 60;

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
  searchParams,
}: PageProps<"/categories/[category]">) {
  const { category } = await params;
  const name = decodeURIComponent(category);

  const requested = Number((await searchParams).page ?? 1);
  const page = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1;

  const [total, companies] = await Promise.all([
    countCompaniesInCategory(name),
    listCompaniesInCategory(name, PER_PAGE, (page - 1) * PER_PAGE),
  ]);

  if (companies.length === 0) notFound();

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const first = (page - 1) * PER_PAGE + 1;
  const pageHref = (n: number) =>
    n === 1
      ? `${routes.category(name)}`
      : `${routes.category(name)}?page=${n}`;

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
        {companiesCount(total)}, most connected first.
        {pages > 1 && (
          <span className="mono ml-2 text-ink-3">
            {first}–{first + companies.length - 1}
          </span>
        )}
      </p>

      <div className="mt-7 max-w-xl">
        <CompanyLookup size="md" placeholder={brand.searchPlaceholder} />
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

      {pages > 1 && (
        <nav
          aria-label="Pages"
          className="mono mt-10 flex items-center justify-between border-t border-line pt-5 text-ink-3"
        >
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="hover:text-accent-ink">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="hover:text-accent-ink">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
