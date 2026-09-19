import type { Metadata } from "next";
import Link from "next/link";
import { CompanyLookup } from "@/components/CompanyLookup";
import { brand } from "@/lib/brand";
import { listCategoryCounts } from "@/lib/db/queries";
import { padCount } from "@/lib/format";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Categories",
  description: `Browse independent software by category on ${brand.name}.`,
};

/**
 * Browsing by what a thing is, rather than by how recently it moved. Only
 * categories that actually contain something are listed — an empty category is
 * a promise the graph cannot keep.
 */
export default async function CategoriesPage() {
  const counts = await listCategoryCounts();

  /*
   * "Other" is the absence of a category, not a category, so it goes last
   * however big it gets. Sorted purely by count it leads the page, which
   * advertises what we could not work out as though it were a section.
   */
  const categories = [
    ...counts.filter(({ category }) => category !== "Other"),
    ...counts.filter(({ category }) => category === "Other"),
  ];

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-[clamp(1.75rem,4.5vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.035em]">
        Browse by category.
      </h1>
      <p className="mt-3 max-w-lg leading-relaxed text-ink-2">
        A company that has claimed its profile picks its own category. The rest
        are our best reading of what the product is, and “Other” is where we
        could not tell. Nothing here is ranked — the number is how many
        companies sit in it.
      </p>

      <div className="mt-7 max-w-xl">
        <CompanyLookup size="md" placeholder={brand.searchPlaceholder} />
      </div>

      {categories.length === 0 ? (
        <p className="mono mt-12 text-ink-3">
          No company has set a category yet.
        </p>
      ) : (
        <ul className="mt-10 grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map(({ category, total }) => (
            <li key={category} className="border-b border-line">
              <Link
                href={routes.category(category)}
                className="flex items-baseline justify-between gap-4 py-3 transition-colors hover:text-accent-ink"
              >
                <span className="font-medium tracking-tight">{category}</span>
                <span className="mono text-ink-3">{padCount(total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
