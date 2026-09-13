import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyLogo } from "@/components/CompanyLogo";
import { CompanyInline } from "@/components/CompanyCard";
import { LocalGraph } from "@/components/LocalGraph";
import { RelationshipJudge } from "@/components/RelationshipJudge";
import { ShareRow } from "@/components/ShareRow";
import { StatusBadge } from "@/components/StatusBadge";
import { judgeRelationship, trackShare } from "@/actions/stack";
import { brand } from "@/lib/brand";
import { companiesCount, companiesSay, padCount, timeAgo } from "@/lib/format";
import { countIncomingOnNetwork, getCompanyBySlug } from "@/lib/db/queries";
import { getProfile } from "@/lib/network";
import { canEdit, editableAmong } from "@/lib/session";
import { stackShareText } from "@/lib/share";
import { reportedBySource, type RelationshipEdge } from "@/lib/types";
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
 * Deliberately thin. No feature matrix, no pricing research, no pros and cons,
 * no verdict: what they build, who it's for, what powers them and who they
 * power. Everything on this page came from the companies themselves.
 */
export default async function CompanyPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const { outgoing, incoming, usedByCount } = await getProfile(company);
  const [mine, onNetwork, judgeable] = await Promise.all([
    canEdit(company.id),
    countIncomingOnNetwork(company.id),
    // A relationship is judged by the company it is *about* — the one said to
    // be using this product — so that is whose edit rights matter here.
    editableAmong(incoming.map((edge) => edge.source.id)),
  ]);

  // Progressive unlock: an unclaimed vendor sees how many companies name them
  // and how many are on the network, but not who. That's the reason to claim.
  const revealed = company.status === "CLAIMED" || mine;

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[clamp(1.875rem,5vw,3rem)] font-medium leading-[1.05] tracking-[-0.035em]">
              {company.name}
            </h1>
            <StatusBadge status={company.status} />
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
                For <span className="text-ink-2">{company.audience}</span>
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
            Visit {company.name} ↗
          </a>
        </div>
      </header>

      {company.status === "UNCLAIMED" && (
        <UnclaimedNotice
          name={company.name}
          slug={company.slug}
          mentions={usedByCount}
          onNetwork={onNetwork}
          detectedFromSite={company.detectedFrom === "website"}
        />
      )}

      {revealed && (
        <LocalGraph
          company={company}
          incoming={incoming}
          outgoing={outgoing}
        />
      )}

      <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Downstream first: who you power is the proof people come for. */}
        {revealed && incoming.length > 0 && (
          <section>
            <SectionHead
              title={`${brand.usedBy} ${companiesCount(usedByCount)}`}
              aside={<span className="mono text-ink-3">Self-reported</span>}
            />
            <div className="border-t border-line">
              {incoming.slice(0, 12).map((edge) => (
                <CompanyInline
                  key={edge.id}
                  company={edge.source}
                  type={edge.type}
                  note={incomingNote(edge, company.name)}
                  action={
                    <EdgeVerdict
                      edge={edge}
                      canJudge={judgeable.has(edge.source.id)}
                    />
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
        )}

        {revealed && outgoing.length > 0 && (
          <section>
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
                  type={edge.type}
                  note={
                    edge.target.networkEligible
                      ? edge.target.domain
                      : `${edge.target.domain} · large tool`
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {company.status === "CLAIMED" && outgoing.length === 0 && (
        <p className="mt-14 max-w-md text-ink-2">
          {company.name} hasn’t named its own tools yet.
        </p>
      )}

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
          <p className="mono max-w-xs text-ink-3">
            {company.detectedFrom === "website"
              ? `Name, description and logo read from ${company.domain}. `
              : ""}
            Every relationship here is what a company says about itself or its
            tools — never a verified-customer claim.
          </p>
        </div>
      </footer>
    </main>
  );
}

/** "Acme says it uses Tally" vs "Tally says Acme uses its product". */
function incomingNote(edge: RelationshipEdge, vendorName: string): string {
  if (reportedBySource(edge)) {
    return `${edge.source.name} says it uses ${vendorName}`;
  }
  return `${vendorName} says ${edge.source.name} uses its product`;
}

/**
 * Where a relationship stands, and — for the company it is about — the
 * two-word reply to it. Bound server actions, so the buttons need no
 * client-side router.
 */
function EdgeVerdict({
  edge,
  canJudge,
}: {
  edge: RelationshipEdge;
  canJudge: boolean;
}) {
  // Both ends have stated it: the strongest version of the same fact.
  if (edge.state === "CONFIRMED") {
    return <span className="mono shrink-0 text-accent-ink">Both confirmed</span>;
  }
  // Their own word about themselves needs no judging.
  if (reportedBySource(edge)) return null;
  if (!canJudge) return null;

  return (
    <RelationshipJudge
      confirm={judgeRelationship.bind(null, edge.id, "CONFIRMED")}
      dispute={judgeRelationship.bind(null, edge.id, "DISPUTED")}
    />
  );
}

/**
 * The honesty panel. An unclaimed profile must never look like the vendor put
 * it there, so it says plainly who supplied what and who hasn't shown up yet.
 */
function UnclaimedNotice({
  name,
  slug,
  mentions,
  onNetwork,
  detectedFromSite,
}: {
  name: string;
  slug: string;
  mentions: number;
  onNetwork: number;
  detectedFromSite: boolean;
}) {
  return (
    <section className="card mt-9 flex flex-col gap-5 border-line-strong p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl">
        <p className="mono text-ink-3">Unclaimed profile</p>
        {mentions > 0 ? (
          <>
            <p className="mt-2 text-xl leading-snug">
              <span className="font-medium">{companiesSay(mentions)}</span> they
              use {name}.
              {onNetwork > 0 && (
                <>
                  {" "}
                  <span className="font-medium">
                    {onNetwork} {onNetwork === 1 ? "is" : "are"}
                  </span>{" "}
                  already on the network.
                </>
              )}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-3">
              Claim this profile to see who they are. Nobody at {name} has
              claimed it yet, so nothing here is a statement from them.
              {detectedFromSite
                ? " The description and logo were read from their public website."
                : ""}
            </p>
          </>
        ) : (
          <p className="mt-2 text-lg leading-relaxed">
            This profile was created by someone else, not by {name}.
          </p>
        )}
      </div>
      <Link href={`/claim/${slug}`} className="btn btn-primary shrink-0">
        {brand.ctaSeeWhoUsesYou}
      </Link>
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
