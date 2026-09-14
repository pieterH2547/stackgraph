import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyLogo } from "@/components/CompanyLogo";
import { CompanyInline } from "@/components/CompanyCard";
import { LocalGraph } from "@/components/LocalGraph";
import { RelationshipJudge } from "@/components/RelationshipJudge";
import { ShareRow } from "@/components/ShareRow";
import { disputeRelationship, trackShare } from "@/actions/stack";
import { brand } from "@/lib/brand";
import { companiesCount, companiesSay, padCount, timeAgo } from "@/lib/format";
import { countIncomingOnNetwork, getCompanyBySlug } from "@/lib/db/queries";
import { getProfile } from "@/lib/network";
import { canEdit } from "@/lib/session";
import { stackShareText } from "@/lib/share";
import type { Company, DetectedTool, RelationshipEdge } from "@/lib/types";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company) return { title: "Not found" };

  const description =
    company.description ??
    `The independent tools powering ${company.name}, and the software companies that use it.`;

  return {
    title: company.name,
    description,
    alternates: { canonical: `/c/${company.slug}` },
    openGraph: {
      title: `${company.name} · ${brand.name}`,
      description,
      url: absoluteUrl(`/c/${company.slug}`),
    },
  };
}

/**
 * Deliberately thin, and valuable because of the graph around the company
 * rather than because we wrote a lot about it. No feature matrix, no pricing
 * research, no pros and cons, no verdict, no "best for".
 *
 * The order of the page is the argument it makes, in the order a founder
 * landing here cold needs it:
 *
 *   1. what is this company
 *   2. who says they use it          <- the strongest thing on the page
 *   3. why claim it, if unclaimed
 *   4. what powers it
 *   5. the graph around it
 *   6. where all of this came from
 *
 * Three states must never be visually confused, so each has its own wording:
 * a relationship is "X says it uses Y"; imported identity is "sourced from
 * public information"; a detected tool is "spotted on their website · not yet
 * confirmed".
 */
export default async function CompanyPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const { outgoing, incoming, usedByCount } = await getProfile(company);
  const [mine, onNetwork] = await Promise.all([
    canEdit(company.id),
    countIncomingOnNetwork(company.id),
  ]);

  const claimed = company.status === "CLAIMED";
  // Progressive unlock: an unclaimed vendor sees how many companies name them
  // and how many are on the network, but not who. That's the reason to claim.
  const revealed = claimed || mine;
  const spotted = claimed ? [] : (company.detectedStack ?? []);

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      {/* 1 — identity */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[clamp(1.875rem,5vw,3rem)] font-medium leading-[1.05] tracking-[-0.035em]">
              {company.name}
            </h1>
            {/* Credible, not loud: a claimed profile earns one tick. */}
            {claimed ? (
              <span className="mono shrink-0 text-accent-ink">✓ Claimed</span>
            ) : (
              <span className="mono shrink-0 text-ink-3">Unclaimed</span>
            )}
          </div>

          {company.description && (
            <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-2">
              {company.description}
            </p>
          )}

          <div className="mono mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-ink-3">
            {company.category && <span>{company.category}</span>}
            {company.audience && (
              <span>
                Built for <span className="text-ink-2">{company.audience}</span>
              </span>
            )}
            {company.builtBy && (
              <span>
                Built by <span className="text-ink-2">{company.builtBy}</span>
              </span>
            )}
            <span>Updated {timeAgo(company.updatedAt)}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {mine && (
            <Link
              href={`/stack/${company.slug}`}
              className="btn btn-secondary !py-2 !text-sm"
            >
              Edit my stack
            </Link>
          )}
          <a
            href={company.website}
            target="_blank"
            rel="noreferrer nofollow"
            className="btn btn-primary !py-2 !text-sm"
          >
            Visit website ↗
          </a>
        </div>
      </header>

      {/* 2 + 3 — the proof, and the reason to claim it */}
      <UsedBy
        company={company}
        incoming={incoming}
        usedByCount={usedByCount}
        onNetwork={onNetwork}
        revealed={revealed}
        mine={mine}
      />

      {/* 4 — what powers it, or what we merely suspect powers it */}
      {outgoing.length > 0 ? (
        <section className="mt-14">
          <SectionHead
            title={brand.poweredBy}
            aside={
              <span className="mono text-ink-3">
                {company.name}&apos;s own words
              </span>
            }
          />
          <div className="border-t border-line">
            {outgoing.map((edge) => (
              <CompanyInline
                key={edge.id}
                company={edge.target}
                note={
                  edge.target.networkEligible
                    ? edge.target.domain
                    : `${edge.target.domain} · large tool`
                }
              />
            ))}
          </div>
        </section>
      ) : spotted.length > 0 ? (
        <SpottedOnSite
          name={company.name}
          domain={company.domain}
          slug={company.slug}
          tools={spotted}
        />
      ) : claimed ? (
        <p className="mono mt-14 text-ink-3">
          {company.name} hasn’t named its own tools yet.
        </p>
      ) : null}

      {/* 5 — the graph, once there is something to draw */}
      {revealed && (
        <LocalGraph company={company} incoming={incoming} outgoing={outgoing} />
      )}

      {/* 6 — provenance, stated plainly and without a wall of legal copy */}
      <footer className="mt-16 border-t border-line pt-7">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="label">Share this stack</p>
            <ShareRow
              url={absoluteUrl(`/share/${company.slug}`)}
              text={stackShareText(company, outgoing)}
              onShare={trackShare.bind(null, company.slug)}
            />
          </div>
          <div className="mono max-w-sm space-y-1.5 text-ink-3">
            <p>
              Every relationship here reads “X says it uses {company.name}” —
              one company’s statement about its own stack, never a
              verified-customer claim.
            </p>
            {!claimed && (
              <p>
                Company information sourced from public information
                {company.detectedFrom === "website"
                  ? ` (${company.domain})`
                  : ""}
                .
              </p>
            )}
          </div>
        </div>
      </footer>
    </main>
  );
}

/**
 * The strongest block on the page, and the one the vendor never wrote. Three
 * shapes, in order of how much they are worth:
 *
 * - claimed, with users:   the names, each attributed
 * - unclaimed, with users: the count, and the names withheld until they claim
 * - nobody yet:            one quiet line, not a large empty box
 */
function UsedBy({
  company,
  incoming,
  usedByCount,
  onNetwork,
  revealed,
  mine,
}: {
  company: Company;
  incoming: RelationshipEdge[];
  usedByCount: number;
  onNetwork: number;
  revealed: boolean;
  mine: boolean;
}) {
  if (usedByCount === 0) {
    return (
      <section className="mt-12 border-t border-line pt-6">
        <p className="mono text-ink-3">
          No {brand.name} company has credited {company.name} yet.
        </p>
        {company.status === "UNCLAIMED" && (
          <p className="mt-4">
            <Link href={`/claim/${company.slug}`} className="btn btn-primary">
              Claim this profile
            </Link>
          </p>
        )}
      </section>
    );
  }

  if (!revealed) {
    // The count is the valuable part, and withholding the names is the whole
    // reason to claim. Nothing here implies the vendor participated.
    return (
      <section className="mt-12 border-l-2 border-accent pl-5 sm:pl-6">
        <p className="label">{brand.usedBy}</p>
        <p className="text-[clamp(1.375rem,3vw,1.875rem)] font-medium leading-tight tracking-[-0.02em]">
          {companiesSay(usedByCount)} they use {company.name}.
        </p>
        {onNetwork > 0 && (
          <p className="mt-2 text-ink-2">
            {onNetwork === usedByCount
              ? `All ${onNetwork === 1 ? "of them is" : onNetwork + " are"} already on the network.`
              : `${onNetwork} of them ${onNetwork === 1 ? "is" : "are"} already on the network.`}
          </p>
        )}
        <p className="mono mt-3 text-ink-3">
          Claim {company.name} to see who. Nobody there has claimed this
          profile, so nothing on it is a statement from them.
        </p>
        <div className="mt-5">
          <Link href={`/claim/${company.slug}`} className="btn btn-primary">
            {brand.ctaSeeWhoUsesYou}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-12">
      <SectionHead
        title={`${brand.usedBy} ${companiesCount(usedByCount)}`}
        aside={<span className="mono text-ink-3">Each company’s own word</span>}
      />
      <div className="border-t border-line">
        {incoming.slice(0, 12).map((edge) => (
          <CompanyInline
            key={edge.id}
            company={edge.source}
            note={`${edge.source.name} says it uses ${company.name}`}
            // Only this vendor can say it doesn't recognise a company that
            // credits it; the statement itself is the other side's to make.
            action={
              mine ? (
                <RelationshipJudge
                  dispute={disputeRelationship.bind(null, edge.id)}
                />
              ) : null
            }
          />
        ))}
      </div>
      {incoming.length > 12 && (
        <p className="mono mt-3 text-ink-3">
          + {padCount(incoming.length - 12)} more
        </p>
      )}
    </section>
  );
}

/**
 * Tools we noticed their pages loading. Deliberately *not* the Powered by
 * block: these are not edges, they earn no claim credit, they put no proof on
 * the other vendor's profile and they trigger no outreach. Only the founder
 * can turn one into a relationship, which is what the button is for.
 */
function SpottedOnSite({
  name,
  domain,
  slug,
  tools,
}: {
  name: string;
  domain: string;
  slug: string;
  tools: DetectedTool[];
}) {
  return (
    <section className="mt-14 border-t border-dashed border-line-strong pt-6">
      <SectionHead
        title="Spotted on their website"
        aside={
          <span className="mono text-ink-3">Not yet confirmed</span>
        }
      />
      <p className="max-w-lg leading-relaxed text-ink-2">
        We noticed these on {domain}. {name} hasn’t confirmed them, so they are
        not part of the graph.
      </p>
      <ul className="mono mt-4 flex flex-wrap gap-2">
        {tools.map((tool) => (
          <li
            key={tool.domain}
            className="rounded border border-dashed border-line-strong px-2.5 py-1 text-ink-3"
          >
            {tool.name}
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <Link href={`/claim/${slug}`} className="btn btn-secondary">
          Claim this profile to confirm your stack
        </Link>
      </div>
    </section>
  );
}

function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-xl font-medium tracking-tight">{title}</h2>
      {aside}
    </div>
  );
}
