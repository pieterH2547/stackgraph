import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ClaimForm } from "@/components/ClaimForm";
import { CompanyLogo } from "@/components/CompanyLogo";
import { startClaim } from "@/actions/claim";
import { brand } from "@/lib/brand";
import {
  countIncoming,
  countIncomingOnNetwork,
  getCompanyBySlug,
} from "@/lib/db/queries";
import { track } from "@/lib/events";
import { REQUIRED_DOWNSTREAM, REQUIRED_UPSTREAM } from "@/lib/limits";
import { padCount } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Claim your profile",
  robots: { index: false },
};

/**
 * Curiosity first, contribution second. The vendor sees that something about
 * them already exists and how much of it there is — but not who — and unlocks
 * the rest by showing both sides of their own company.
 */
export default async function ClaimPage({
  params,
  searchParams,
}: PageProps<"/claim/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;

  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  if (query.ref === "email") {
    // Recorded after the response, so the page still renders instantly.
    after(() =>
      track("claim_clicked", {
        companyId: company.id,
        props: { ref: "email" },
      }),
    );
  }

  if (company.status === "CLAIMED") {
    return (
      <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <h1 className="text-3xl font-medium tracking-tight">
          {company.name} is already claimed.
        </h1>
        <p className="mt-4 max-w-md text-ink-2">
          Someone from {company.name} got here first. If that wasn’t you, reply
          to the email that brought you here.
        </p>
        <Link href={`/c/${company.slug}`} className="btn btn-primary mt-7">
          View the profile
        </Link>
      </main>
    );
  }

  const [usedBy, onNetwork] = await Promise.all([
    countIncoming(company.id),
    countIncomingOnNetwork(company.id),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
        <div>
          <div className="flex items-center gap-4">
            <CompanyLogo
              name={company.name}
              logoUrl={company.logoUrl}
              size="lg"
            />
            <div>
              <p className="mono text-ink-3">Unclaimed · {company.domain}</p>
              <p className="text-xl font-medium tracking-tight">
                {company.name}
              </p>
            </div>
          </div>

          <h1 className="mt-8 max-w-xl text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            {usedBy > 0
              ? "Someone actually uses your software."
              : `Claim ${company.name}.`}
          </h1>

          {usedBy > 0 ? (
            <div className="mt-6 max-w-lg border-l-2 border-accent pl-5">
              <p className="text-lg leading-relaxed">
                <span className="font-medium">
                  {usedBy} software {usedBy === 1 ? "company" : "companies"}
                </span>{" "}
                say they use your product.
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
              <p className="mono mt-3 text-ink-3">
                Claim your profile to see who they are.
              </p>
            </div>
          ) : (
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-2">
              This profile is waiting for you. Claim it to show what powers your
              company and who you power.
            </p>
          )}

          <ClaimForm
            action={startClaim.bind(null, company.slug)}
            companyName={company.name}
          />
        </div>

        <aside>
          <p className="label">What unlocking takes</p>
          <ol className="space-y-4 border-t border-line pt-4">
            <Step n="1" title="Confirm your email">
              One link. No password, no sales call.
            </Step>
            <Step n="2" title={`What powers you? ${REQUIRED_UPSTREAM}`}>
              Independent tools you genuinely use. We suggest them from your own
              site — usually a click each.
            </Step>
            <Step n="3" title={`Who do you power? ${REQUIRED_DOWNSTREAM}`}>
              Software companies using your product. Shown as your word until
              they confirm it.
            </Step>
          </ol>
          <p className="mono mt-6 text-ink-3">
            {brand.noQuestionnaire}
          </p>
          <p className="mono mt-3 text-ink-3">
            Used by {padCount(usedBy)} · on network {padCount(onNetwork)} ·
            claiming is free
          </p>
        </aside>
      </div>
    </main>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <span className="mono mt-0.5 shrink-0 text-ink-3">{n}</span>
      <span>
        <span className="block font-medium tracking-tight">{title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-ink-3">
          {children}
        </span>
      </span>
    </li>
  );
}
