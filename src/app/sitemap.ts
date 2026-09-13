import type { MetadataRoute } from "next";
import { listAllCompanySlugs } from "@/lib/db/queries";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/** Public company pages are the indexable surface; the flows are not. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const companies = await listAllCompanySlugs();

  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/network"), changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/add"), changeFrequency: "monthly", priority: 0.5 },
    ...companies.map((company) => ({
      url: absoluteUrl(`/c/${company.slug}`),
      lastModified: new Date(company.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
