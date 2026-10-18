import { redirect } from "next/navigation";
import { getCompanyBySlug } from "@/lib/db/queries";
import { routes } from "@/lib/routes";
import { track } from "@/lib/events";

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
export default async function ClaimPage({
  params,
  searchParams,
}: PageProps<"/claim/[slug]">) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);

  /*
   * The one place the flywheel can be observed turning.
   *
   * `claim_clicked` has been in the event list since the beginning and
   * nothing ever recorded it, so the number on the metrics page was always
   * zero — not because nobody clicked, but because nobody was counting. This
   * is the door the recognition email points at (`routes.claimFromEmail`
   * appends `?ref=email`), so arriving here is the fact that somebody
   * followed our link. Recorded on a redirect that already happened: no
   * extra step, no extra page, nothing asked of the person.
   */
  if (company) {
    const query = await searchParams;
    await track("claim_clicked", {
      companyId: company.id,
      props: {
        ref: typeof query.ref === "string" ? query.ref.slice(0, 32) : "direct",
        source: company.source,
        generation: company.generation,
      },
    });
  }

  redirect(company ? routes.signInFor(company.slug) : routes.add());
}
