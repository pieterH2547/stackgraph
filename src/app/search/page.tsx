import type { Metadata } from "next";
import Link from "next/link";
import { CompanyCard } from "@/components/CompanyCard";
import { SiteSearch } from "@/components/SiteSearch";
import { brand } from "@/lib/brand";
import { findCompanies } from "@/lib/db/queries";
import { padCount } from "@/lib/format";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  description: `Find a company on ${brand.name} and see who uses it.`,
};

/**
 * The lookup that was missing. Somebody who hears "check who uses Tally" had
 * no way to do it: search only existed inside the stack editor, behind a
 * claim. This is the public version, and a shareable URL.
 */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const results = q ? await findCompanies(q) : [];

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-[clamp(1.75rem,4.5vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.035em]">
        {q ? `“${q}”` : "Search the graph."}
      </h1>
      <p className="mt-3 max-w-lg leading-relaxed text-ink-2">
        {q
          ? `${padCount(results.length)} ${results.length === 1 ? "match" : "matches"} by name, domain or what they say they do.`
          : "Look up a company and see which independent tools it runs on, and who runs on it."}
      </p>

      <div className="mt-7 max-w-xl">
        <SiteSearch defaultValue={q} autoFocus={!q} />
      </div>

      {q && results.length === 0 && (
        <div className="mt-12 border-t border-line pt-7">
          <p className="text-lg">Nothing here by that name yet.</p>
          <p className="mono mt-2 max-w-md text-ink-3">
            The graph only contains companies somebody has credited or claimed,
            so an absence means nobody has named them — not that they don’t
            exist.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={routes.add()} className="btn btn-primary">
              {brand.ctaPrimary}
            </Link>
            <Link href={routes.categories()} className="btn btn-secondary">
              Browse by category
            </Link>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              usedBy={company.incoming}
            />
          ))}
        </div>
      )}
    </main>
  );
}
