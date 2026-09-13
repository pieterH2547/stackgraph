import { NextResponse } from "next/server";
import { getCompanyBySlug } from "@/lib/db/queries";
import { canEdit } from "@/lib/session";
import { suggestPoweredBy, suggestUsedBy } from "@/lib/signals";

export const dynamic = "force-dynamic";

/**
 * Prefill for one half of a claim, read from the company's own public site.
 *
 * Takes a slug rather than a URL and is gated on being able to edit that
 * company, so this can never be used as a general-purpose fetcher for someone
 * else's benefit.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const kind = url.searchParams.get("kind") === "customers" ? "customers" : "tools";

  const company = await getCompanyBySlug(slug);
  if (!company) {
    return NextResponse.json({ suggestions: [] }, { status: 404 });
  }
  if (!(await canEdit(company.id))) {
    return NextResponse.json({ suggestions: [] }, { status: 403 });
  }

  const suggestions =
    kind === "customers"
      ? await suggestUsedBy(company.website, company.domain)
      : await suggestPoweredBy(company.website, company.domain);

  return NextResponse.json({ suggestions });
}
