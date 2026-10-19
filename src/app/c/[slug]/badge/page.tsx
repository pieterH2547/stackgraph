import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeEmbed, type BadgeVariant } from "@/components/BadgeEmbed";
import { trackShare } from "@/actions/stack";
import { badgeAlt } from "@/lib/badge/embed";
import {
  badgeAvailable,
  countBadgeUsedBy,
  getBadgeStats,
} from "@/lib/badge/stats";
import { BADGE_THEMES, renderBadge, type BadgeTheme } from "@/lib/badge/svg";
import { brand } from "@/lib/brand";
import { getCompanyBySlug } from "@/lib/db/queries";
import { companiesSay } from "@/lib/format";
import { routes } from "@/lib/routes";
import { canEdit } from "@/lib/session";
import { canManage } from "@/lib/auth/session";
import { absoluteUrl, withBasePath } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]/badge">): Promise<Metadata> {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  return {
    title: company ? `${company.name} badge` : "Not found",
    robots: { index: false },
  };
}

/**
 * Where a company picks up its badge.
 *
 * Public, like the badge: there is nothing secret about an image anyone can
 * load, and a founder who has not signed in on this laptop should still be
 * able to copy the code. Only the measurement is for the people who manage
 * the company.
 *
 * The page's job is to be honest about what the badge says and what it does
 * not — on the page, in the alt text, and inside the image — and to make the
 * no-link version as easy to pick as the linked one.
 */
export default async function BadgePage({ params }: PageProps<"/c/[slug]/badge">) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  if (!badgeAvailable(company)) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <p className="mono text-ink-3">{brand.badge.heading}</p>
        <h1 className="mt-3 text-[clamp(1.75rem,4.5vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.035em]">
          Badges are for claimed profiles.
        </h1>
        <p className="mt-4 max-w-lg leading-relaxed text-ink-2">
          Nobody at {company.name} has claimed this profile yet, so nothing on
          it is a statement from them — and a badge on their site would be.
          Claiming is what makes the count theirs to show, and theirs to
          dispute.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href={routes.signInFor(company.slug)} className="btn btn-primary">
            {brand.ctaClaim}
          </Link>
          <Link href={routes.profile(company.slug)} className="btn btn-secondary">
            Back to the profile
          </Link>
        </div>
      </main>
    );
  }

  const [count, manages, legacyEditor] = await Promise.all([
    countBadgeUsedBy(company.id),
    canManage(company.id),
    canEdit(company.id),
  ]);
  const mine = manages || legacyEditor;
  const stats = mine ? await getBadgeStats(company.id, 30) : null;

  const variants = Object.fromEntries(
    BADGE_THEMES.map((theme) => {
      const rendered = renderBadge({ name: company.name, count, theme });
      const path = routes.badgeImage(company.slug, theme);
      return [
        theme,
        {
          imageUrl: absoluteUrl(path),
          previewSrc: withBasePath(`${path}${path.includes("?") ? "&" : "?"}preview=1`),
          width: rendered.width,
          height: rendered.height,
        } satisfies BadgeVariant,
      ];
    }),
  ) as Record<BadgeTheme, BadgeVariant>;

  return (
    <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="mono text-ink-3">{brand.badge.heading}</p>
      <h1 className="mt-3 text-[clamp(1.75rem,4.5vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.035em]">
        {count > 0
          ? `${companiesSay(count)} they use ${company.name}. Show it.`
          : `${company.name} is on the graph. Show it.`}
      </h1>
      <p className="mt-4 max-w-xl leading-relaxed text-ink-2">
        {count > 0
          ? "The badge carries the live count from your profile, in the profile's own words. It updates itself; once it is on your site there is nothing to maintain."
          : "Nobody has credited you yet, so the badge says the one thing that is true today — that you are here — and starts counting the moment the first company names you."}
      </p>

      <BadgeEmbed
        variants={variants}
        profileUrl={absoluteUrl(routes.profileFromBadge(company.slug))}
        alt={badgeAlt(company.name)}
        onCopy={trackShare.bind(null, company.slug)}
      />

      <section className="mt-12 border-t border-line pt-7">
        <h2 className="text-xl font-medium tracking-tight">What it counts</h2>
        <ul className="mt-3 max-w-xl space-y-2 leading-relaxed text-ink-2">
          <li>{brand.badge.honesty}</li>
          <li>
            A relationship you removed as “not accurate” is not counted, and
            neither is anything from a demo dataset. If the profile would not
            show it, the badge will not either.
          </li>
          <li>
            Browsers and our cache hold the image for up to an hour, so a
            change on your profile reaches the badge within that time.
          </li>
        </ul>
      </section>

      <section className="mt-10 border-t border-line pt-7">
        <h2 className="text-xl font-medium tracking-tight">Entirely optional</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-2">
          Nothing here depends on the badge: not your claim, not your profile,
          not where you appear. Take it down whenever you like. It is yours to
          use because the number is yours to show.
        </p>
      </section>

      {stats && (
        <section className="mt-10 border-t border-line pt-7">
          <h2 className="text-xl font-medium tracking-tight">
            Last {stats.days} days
          </h2>
          <dl className="mt-4 grid max-w-md grid-cols-2 gap-6">
            <div>
              <dt className="label">Badge loads</dt>
              <dd className="text-3xl font-medium tracking-tight">
                {stats.views.toLocaleString("en-GB")}
              </dd>
            </div>
            <div>
              <dt className="label">Clicks to your profile</dt>
              <dd className="text-3xl font-medium tracking-tight">
                {stats.clicks.toLocaleString("en-GB")}
              </dd>
            </div>
          </dl>
          <p className="mono mt-4 max-w-md text-ink-3">
            Counts, not people. We keep no IP address, user agent, referrer or
            cookie for this — one tally per day. Loads served from a cache are
            not seen here, so the real number is higher.
          </p>
        </section>
      )}

      <p className="mt-10">
        <Link
          href={routes.profile(company.slug)}
          className="mono text-ink-3 hover:text-accent-ink"
        >
          ← {company.name}&apos;s profile
        </Link>
      </p>
    </main>
  );
}
