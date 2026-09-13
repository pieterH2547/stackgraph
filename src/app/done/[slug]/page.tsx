import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyLogo } from "@/components/CompanyLogo";
import { LocalGraph } from "@/components/LocalGraph";
import { ShareRow } from "@/components/ShareRow";
import { trackShare } from "@/actions/stack";
import {
  getCompanyBySlug,
  listIncomingEdges,
  listOutgoingEdges,
} from "@/lib/db/queries";
import { REQUIRED_DOWNSTREAM, REQUIRED_UPSTREAM } from "@/lib/limits";
import { getClaimProgress } from "@/lib/network";
import { stackShareText } from "@/lib/share";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile unlocked",
  robots: { index: false },
};

/** The unlock moment: what the vendor just earned, in three ticks. */
export default async function DonePage({ params }: PageProps<"/done/[slug]">) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const [outgoing, incoming, progress] = await Promise.all([
    listOutgoingEdges(company.id),
    listIncomingEdges(company.id),
    getClaimProgress(company),
  ]);

  const claimed = company.status === "CLAIMED";
  const independent = outgoing.filter((edge) => edge.target.networkEligible);
  const shareUrl = absoluteUrl(`/share/${company.slug}`);

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="mono text-accent-ink">
        {claimed ? "Unlocked" : "Almost"}
      </p>
      <h1 className="mt-3 max-w-2xl text-[clamp(2rem,5.5vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        {claimed
          ? `${company.name} is live on the graph.`
          : "One half to go."}
      </h1>

      {claimed ? (
        <ul className="mt-8 space-y-2.5">
          <Tick>Profile claimed</Tick>
          <Tick>
            See all {incoming.length}{" "}
            {incoming.length === 1 ? "company" : "companies"} using you
          </Tick>
          <Tick>Your network is now live</Tick>
        </ul>
      ) : (
        <div className="mono mt-8 flex flex-wrap gap-x-8 gap-y-2">
          <span>
            What powers you? {Math.min(progress.upstream, REQUIRED_UPSTREAM)}/
            {REQUIRED_UPSTREAM}
          </span>
          <span>
            Who do you power?{" "}
            {Math.min(progress.downstream, REQUIRED_DOWNSTREAM)}/
            {REQUIRED_DOWNSTREAM}
          </span>
        </div>
      )}

      <LocalGraph company={company} incoming={incoming} outgoing={outgoing} />

      {independent.length > 0 && (
        <p className="mt-10 max-w-xl text-lg leading-relaxed text-ink-2">
          You just gave credit to{" "}
          <span className="font-medium text-ink">
            {independent.length} independent software{" "}
            {independent.length === 1 ? "company" : "companies"}
          </span>
          . They’ll hear about it.
        </p>
      )}

      <div className="mt-9 flex flex-wrap items-center gap-3">
        {claimed ? (
          <Link href={`/c/${company.slug}`} className="btn btn-primary">
            View my profile
          </Link>
        ) : (
          <Link href={`/stack/${company.slug}`} className="btn btn-primary">
            Finish the other half
          </Link>
        )}
        <Link href={`/share/${company.slug}`} className="btn btn-secondary">
          Share my stack
        </Link>
      </div>

      <div className="mt-8 flex items-start gap-4 border-t border-line pt-7">
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="sm" />
        <div>
          <p className="label">Share it</p>
          <ShareRow
            url={shareUrl}
            text={stackShareText(company, outgoing)}
            onShare={trackShare.bind(null, company.slug)}
          />
        </div>
      </div>
    </main>
  );
}

function Tick({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-lg">
      <span aria-hidden className="text-accent">
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}
