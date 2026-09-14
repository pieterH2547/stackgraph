import { redirect } from "next/navigation";
import { getCompanyBySlug } from "@/lib/db/queries";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

/**
 * Kept as a door, not a flow.
 *
 * Links to /claim/<slug> are already out in the world — in recognition emails
 * that were sent before accounts existed — so the URL has to keep working.
 * What it no longer does is run its own claim: two claim flows would drift
 * apart, and the one that drifted was the one that handed out edit rights to
 * any address that could receive mail. Everything now goes through sign-in,
 * where ownership is decided once.
 */
export default async function ClaimPage({ params }: PageProps<"/claim/[slug]">) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  redirect(company ? routes.signInFor(company.slug) : routes.add());
}
