import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyInline } from "@/components/CompanyCard";
import { CompanyLogo } from "@/components/CompanyLogo";
import { StackEditor } from "@/components/StackEditor";
import { saveCustomers, saveStack } from "@/actions/stack";
import { brand } from "@/lib/brand";
import {
  getCompanyBySlug,
  listIncomingEdges,
  listOutgoingEdges,
} from "@/lib/db/queries";
import {
  MAX_CUSTOMERS,
  MAX_TOOLS,
  REQUIRED_DOWNSTREAM,
  REQUIRED_UPSTREAM,
} from "@/lib/limits";
import { getClaimProgress } from "@/lib/network";
import { suggestPoweredBy, suggestUsedBy } from "@/lib/signals";
import { canEdit } from "@/lib/session";
import type { Company, RelationshipEdge } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unlock your profile",
  robots: { index: false },
};

/**
 * The unlock page. Both sides of the company, two each, and the suggestions
 * are prefilled from the vendor's own site so this is closer to
 * confirm → confirm → done than to filling in a form.
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
          If {company.name} is yours, claim the profile and both sides are yours
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

  const [outgoing, incoming, progress] = await Promise.all([
    listOutgoingEdges(company.id),
    listIncomingEdges(company.id),
    getClaimProgress(company),
  ]);

  const claimed = company.status === "CLAIMED";
  const namedCustomers = incoming.filter(
    (edge) => edge.reportedByCompanyId === company.id,
  );

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
      {justVerified && (
        <p className="mono text-accent-ink">Email confirmed</p>
      )}

      <div className="mt-3 flex items-start gap-4">
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="lg" />
        <div>
          <h1 className="max-w-2xl text-[clamp(1.75rem,4.5vw,2.75rem)] font-medium leading-[1.05] tracking-[-0.035em]">
            {claimed
              ? "Anything missing?"
              : "Show both sides of your company to unlock your profile."}
          </h1>
          <p className="mono mt-2 text-ink-3">{company.domain}</p>
        </div>
      </div>

      {!claimed && (
        <div className="mono mt-7 flex flex-wrap gap-x-8 gap-y-2 border-y border-line py-4">
          <span>
            What powers you?{" "}
            <Counter value={progress.upstream} required={REQUIRED_UPSTREAM} />
          </span>
          <span>
            Who do you power?{" "}
            <Counter
              value={progress.downstream}
              required={REQUIRED_DOWNSTREAM}
            />
          </span>
        </div>
      )}

      <div className="mt-12 grid gap-14 lg:grid-cols-2 lg:gap-16">
        <section>
          <h2 className="text-xl font-medium tracking-tight">
            {brand.stackPrompt}
          </h2>
          <p className="mt-2 max-w-md leading-relaxed text-ink-2">
            {brand.stackPromptSupport}
          </p>
          <p className="mono mt-3 max-w-md text-ink-3">
            Stripe and Vercel can sit in your stack, they just don’t count
            towards the two. Big tools may appear in the graph; small tools are
            the graph.
          </p>

          {outgoing.length > 0 && (
            <ExistingList
              label={`Already credited · ${progress.upstream}/${REQUIRED_UPSTREAM} independent`}
              edges={outgoing}
              pick={(edge) => edge.target}
            />
          )}

          <Suspense fallback={<EditorSkeleton />}>
            <PoweredByEditor
              company={company}
              existingCredits={progress.upstream}
              required={claimed ? 0 : REQUIRED_UPSTREAM}
            />
          </Suspense>
        </section>

        <section>
          <h2 className="text-xl font-medium tracking-tight">
            {brand.customersPrompt}
          </h2>
          <p className="mt-2 max-w-md leading-relaxed text-ink-2">
            {brand.customersPromptSupport}
          </p>
          <p className="mono mt-3 max-w-md text-ink-3">
            Nobody you name has to confirm anything for your claim to complete.
          </p>

          {namedCustomers.length > 0 && (
            <ExistingList
              label={`Already named · ${progress.downstream}/${REQUIRED_DOWNSTREAM}`}
              edges={namedCustomers}
              pick={(edge) => edge.source}
            />
          )}

          <Suspense fallback={<EditorSkeleton />}>
            <UsedByEditor
              company={company}
              existingCredits={progress.downstream}
              required={claimed ? 0 : REQUIRED_DOWNSTREAM}
            />
          </Suspense>
        </section>
      </div>
    </main>
  );
}

/** Suggestions need the vendor's website read, so they stream in separately. */
async function PoweredByEditor({
  company,
  existingCredits,
  required,
}: {
  company: Company;
  existingCredits: number;
  required: number;
}) {
  const suggestions = await suggestPoweredBy(company.website, company.domain);

  return (
    <StackEditor
      action={saveStack.bind(null, company.slug)}
      companyName={company.name}
      mode="tools"
      max={MAX_TOOLS}
      existingCredits={existingCredits}
      requiredCredits={required}
      suggestions={suggestions}
      submitLabel="Save what powers us"
    />
  );
}

async function UsedByEditor({
  company,
  existingCredits,
  required,
}: {
  company: Company;
  existingCredits: number;
  required: number;
}) {
  const suggestions = await suggestUsedBy(company.website, company.domain);

  return (
    <StackEditor
      action={saveCustomers.bind(null, company.slug)}
      companyName={company.name}
      mode="customers"
      max={MAX_CUSTOMERS}
      existingCredits={existingCredits}
      requiredCredits={required}
      suggestions={suggestions}
      submitLabel="Save who we power"
    />
  );
}

function Counter({ value, required }: { value: number; required: number }) {
  const done = value >= required;
  return (
    <span className={done ? "text-accent-ink" : "text-ink"}>
      {Math.min(value, required)}/{required}
      {done ? " ✓" : ""}
    </span>
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
            type={edge.type}
          />
        ))}
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="mt-8">
      <p className="label">Reading your site for suggestions…</p>
      <div className="h-12 animate-pulse rounded-md border border-line bg-surface" />
    </div>
  );
}
