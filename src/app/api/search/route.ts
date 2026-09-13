import { NextResponse } from "next/server";
import { searchCompanies } from "@/lib/db/queries";
import { assessEligibility } from "@/lib/eligibility";
import { tryNormalizeSiteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * Typeahead for the stack editor. Kept tiny: this has to feel instant.
 *
 * It also answers whether a typed domain counts towards the independent tools
 * a claim costs, because the incumbent list lives on the server.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 60);
  const exclude = (url.searchParams.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (query.trim().length < 2) {
    return NextResponse.json({ results: [], typed: null });
  }

  const companies = await searchCompanies(query, {
    limit: 6,
    excludeIds: exclude,
  });

  const normalized = tryNormalizeSiteUrl(query.trim());
  const typed = normalized
    ? {
        domain: normalized.domain,
        website: normalized.website,
        networkEligible: assessEligibility(normalized.domain).networkEligible,
      }
    : null;

  return NextResponse.json({
    results: companies.map((company) => ({
      id: company.id,
      name: company.name,
      slug: company.slug,
      domain: company.domain,
      logoUrl: company.logoUrl,
      status: company.status,
      networkEligible: company.networkEligible,
    })),
    typed,
  });
}
