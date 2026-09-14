import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyInline } from "@/components/CompanyCard";
import { CompanyLogo } from "@/components/CompanyLogo";
import { StackEditor } from "@/components/StackEditor";
import { saveStack } from "@/actions/stack";
import { brand } from "@/lib/brand";
import { getCompanyBySlug, listOutgoingEdges } from "@/lib/db/queries";
import { MAX_TOOLS, REQUIRED_UPSTREAM } from "@/lib/limits";
import { getClaimProgress } from "@/lib/network";
import { canEdit } from "@/lib/session";
import type { Company, RelationshipEdge } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unlock your profile",
  robots: { index: false },
};

/**
 * The unlock page. One question — what powers you — with the suggestions
 * prefilled from the vendor's own site, so this is closer to confirm → done
 * than to filling in a form.
 *
 * Naming your own customers used to be the second half of this page, and it is
 * gone entirely rather than moved. A company only reports facts about its own
 * stack; the `used by` side of a profile is assembled from other companies'
 * statements, so there was never anything here for a vendor to submit.
 */
export default async function StackPage({
  params,
  searchParams,
}: PageProps<"/stack/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;
  const justVerified = query.after === "claim";

  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  if (!(await canEdit(company.id))) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <h1 className="text-3xl font-medium tracking-tight">
          This isn’t your company to edit.
        </h1>
        <p className="mt-4 max-w-md text-ink-2">
          If {company.name} is yours, claim the profile and its stack is yours
          to fill in.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          {company.status === "UNCLAIMED" && (
            <Link href={`/claim/${company.slug}`} className="btn btn-primary">
              {brand.ctaClaim}
            </Link>
          )}
          <Link href={`/c/${company.slug}`} className="btn btn-secondary">
            View profile
          </Link>
        </div>
      </main>
    );
  }

  const [outgoing, progress] = await Promise.all([
    listOutgoingEdges(company.id),
    getClaimProgress(company),
  ]);

  const claimed = company.status === "CLAIMED";

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="mono text-ink-3">
        {justVerified ? "Email confirmed · last step" : "Step 3 of 3"}
      </p>

      <div className="mt-3 flex items-start gap-4">
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="lg" />
        <div>
          <h1 className="max-w-2xl text-[clamp(1.75rem,4.5vw,2.75rem)] font-medium leading-[1.05] tracking-[-0.035em]">
            {claimed
              ? `Anything missing from ${company.name}?`
              : "Add 2 tools you genuinely use."}
          </h1>
          <p className="mono mt-2 text-ink-3">{company.domain}</p>
        </div>
      </div>

      <section className="mt-10 max-w-xl">
        <p className="text-lg leading-relaxed text-ink-2">
          {brand.stackPromptSupport}
        </p>

        {outgoing.length > 0 && (
          <ExistingList
            label={`Already credited · ${progress.upstream}/${REQUIRED_UPSTREAM} independent`}
            edges={outgoing}
            pick={(edge) => edge.target}
          />
        )}

        <StackEditor
          action={saveStack.bind(null, company.slug)}
          companyName={company.name}
          companyDomain={company.domain}
          max={MAX_TOOLS}
          existingCredits={progress.upstream}
          requiredCredits={claimed ? 0 : REQUIRED_UPSTREAM}
          suggestionsFor={company.slug}
          submitLabel="Save my stack"
        />
      </section>
    </main>
  );
}

function ExistingList({
  label,
  edges,
  pick,
}: {
  label: string;
  edges: RelationshipEdge[];
  pick: (edge: RelationshipEdge) => Company;
}) {
  return (
    <div className="mt-6">
      <p className="label">{label}</p>
      <div className="border-t border-line">
        {edges.map((edge) => (
          <CompanyInline
            key={edge.id}
            company={pick(edge)}
          />
        ))}
      </div>
    </div>
  );
}

