import { NextResponse } from "next/server";
import { getCompanyBySlug } from "@/lib/db/queries";
import { canEdit } from "@/lib/session";
import { canManage } from "@/lib/auth/session";
import { suggestPoweredBy } from "@/lib/signals";

export const dynamic = "force-dynamic";

/**
 * Prefill for a claim, read from the company's own public site: third-party
 * hosts its pages actually load from. Suggestions only — every one of them
 * needs a click, because a correct edge is worth more than an extra edge.
 *
 * Takes a slug rather than a URL and is gated on being able to edit that
 * company, so this can never be used as a general-purpose fetcher for someone
 * else's benefit.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";

  const company = await getCompanyBySlug(slug);
  if (!company) {
    return NextResponse.json({ suggestions: [] }, { status: 404 });
  }
  // Either door: a member of the company, or the legacy edit-token cookie
  // from a claim made before accounts existed.
  if (!(await canManage(company.id)) && !(await canEdit(company.id))) {
    return NextResponse.json({ suggestions: [] }, { status: 403 });
  }

  const suggestions = await suggestPoweredBy(company.website, company.domain);
  return NextResponse.json({ suggestions });
}
