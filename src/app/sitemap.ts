import type { MetadataRoute } from "next";
import { listAllCompanySlugs, listCategoryCounts } from "@/lib/db/queries";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/** Public company pages are the indexable surface; the flows are not. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [companies, categories] = await Promise.all([
    listAllCompanySlugs(),
    listCategoryCounts(),
  ]);

  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/network"), changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/categories"), changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/add"), changeFrequency: "monthly", priority: 0.5 },
    // A category page with nothing in it 404s, so only the populated ones.
    ...categories.map(({ category }) => ({
      url: absoluteUrl(`/categories/${encodeURIComponent(category)}`),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...companies.map((company) => ({
      url: absoluteUrl(`/c/${company.slug}`),
      lastModified: new Date(company.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
