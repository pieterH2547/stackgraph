import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { CompanyLogo } from "@/components/CompanyLogo";
import { completeClaim } from "@/actions/claim";
import { claimExpired, getClaimByToken } from "@/lib/claims";
import { getCompanyById, getCompanyBySlug } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm your claim",
  robots: { index: false },
};

/**
 * The link lands here rather than mutating on GET, so a mail client prefetch
 * can’t claim a profile. One button, then straight into the stack step.
 */
export default async function VerifyClaimPage({
  params,
  searchParams,
}: PageProps<"/claim/[slug]/verify">) {
  const { slug } = await params;
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";

  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const claim = token ? await getClaimByToken(token) : null;

  if (!claim || claim.companyId !== company.id || claimExpired(claim)) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <h1 className="text-3xl font-medium tracking-tight">
          That link has expired.
        </h1>
        <p className="mt-4 max-w-md text-ink-2">
          Claim links last 72 hours. Start again and we’ll send a fresh one.
        </p>
        <Link href={`/claim/${company.slug}`} className="btn btn-primary mt-7">
          Claim {company.name}
        </Link>
      </main>
    );
  }

  if (company.status === "CLAIMED") {
    const owner = await getCompanyById(company.id);
    redirect(`/c/${owner?.slug ?? company.slug}`);
  }

  const claimAction = async () => {
    "use server";
    await completeClaim(token);
    return {};
  };

  return (
    <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="flex items-center gap-4">
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="lg" />
        <div>
          <p className="mono text-ink-3">Verified · {claim.email}</p>
          <p className="text-xl font-medium tracking-tight">{company.name}</p>
        </div>
      </div>

      <h1 className="mt-8 max-w-xl text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        {company.name} is yours.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-2">
        One click and the profile is claimed. Then the interesting question:
        which independent tools help power {company.name}?
      </p>

      <div className="mt-8">
        <ActionButton
          action={claimAction}
          label={`Claim ${company.name}`}
          pendingLabel="Claiming…"
        />
      </div>
    </main>
  );
}
