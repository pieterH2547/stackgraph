import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CompanyInline } from "@/components/CompanyCard";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ManageStack } from "@/components/ManageStack";
import { ProfileForm } from "@/components/ProfileForm";
import { RetractCredit } from "@/components/RetractCredit";
import { disputeIncoming, removeTool } from "@/actions/manage";
import { brand } from "@/lib/brand";
import { companiesCount, timeAgo } from "@/lib/format";
import { listIncomingEdges, listOutgoingEdges } from "@/lib/db/queries";
import { REQUIRED_UPSTREAM } from "@/lib/limits";
import { getClaimProgress } from "@/lib/network";
import { routes } from "@/lib/routes";
import { currentUser, roleFor } from "@/lib/auth/session";
import { getCompanyBySlug } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage",
  robots: { index: false },
};

/**
 * The owner's whole surface. One page, not a portal: who uses you, what you
 * run on, and the few fields you control.
 *
 * Authorisation happens here and again inside every action. This check decides
 * what to render; the action's own check is what actually protects anything.
 */
export default async function ManagePage({ params }: PageProps<"/manage/[slug]">) {
  const { slug } = await params;

  const user = await currentUser();
  if (!user) redirect(routes.signInFor(slug));

  const company = await getCompanyBySlug(slug);
  if (!company) redirect(routes.dashboard());

  const role = await roleFor(company.id, user);
  if (!role) redirect(`${routes.profile(slug)}?claim=refused&why=ALREADY_CLAIMED`);

  const [outgoing, incoming, progress] = await Promise.all([
    listOutgoingEdges(company.id),
    listIncomingEdges(company.id),
    getClaimProgress(company),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="lg" />
          <div>
            <p className="mono text-ink-3">
              {role === "OWNER" ? "You manage this" : `Your role: ${role}`}
            </p>
            <h1 className="mt-1 text-[clamp(1.5rem,4vw,2.25rem)] font-medium leading-[1.05] tracking-[-0.035em]">
              {company.name}
            </h1>
            <p className="mono mt-1 text-ink-3">
              {company.domain} · updated {timeAgo(company.updatedAt)}
            </p>
          </div>
        </div>
        <Link
          href={routes.profile(company.slug)}
          className="btn btn-secondary !py-2 !text-sm"
        >
          View public profile
        </Link>
      </div>

      {/* Who uses you: the reason to be here, so it is first. */}
      <section className="mt-12">
        <h2 className="text-xl font-medium tracking-tight">
          {brand.usedBy}{" "}
          <span className="text-ink-3">{companiesCount(incoming.length)}</span>
        </h2>
        <p className="mt-2 max-w-lg leading-relaxed text-ink-2">
          Every line is another company’s own statement about its own stack.
          Nothing here was written by us, and nothing needs your approval to be
          true — but if you don’t recognise a company at all, remove it.
        </p>

        {incoming.length === 0 ? (
          <p className="mono mt-5 text-ink-3">
            Nobody has credited {company.name} yet.
          </p>
        ) : (
          <div className="mt-5 border-t border-line">
            {incoming.map((edge) => (
              <CompanyInline
                key={edge.id}
                company={edge.source}
                note={`${edge.source.name} says it uses ${company.name} · first-party`}
                action={
                  <RetractCredit
                    toolName={edge.source.name}
                    action={disputeIncoming.bind(null, slug, edge.id)}
                  />
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Your stack. */}
      <section className="mt-14">
        <h2 className="text-xl font-medium tracking-tight">{brand.poweredBy}</h2>
        <p className="mt-2 max-w-lg leading-relaxed text-ink-2">
          {progress.upstream}/{REQUIRED_UPSTREAM} independent tools credited.
          Each one puts {company.name} in that tool’s {brand.usedBy}.
        </p>

        {outgoing.length > 0 && (
          <div className="mt-5 border-t border-line">
            {outgoing.map((edge) => (
              <CompanyInline
                key={edge.id}
                company={edge.target}
                note={
                  edge.target.networkEligible
                    ? edge.target.domain
                    : `${edge.target.domain} · large tool, doesn’t count towards the two`
                }
                action={
                  <RetractCredit
                    toolName={edge.target.name}
                    action={removeTool.bind(null, slug, edge.id)}
                  />
                }
              />
            ))}
          </div>
        )}

        <ManageStack
          slug={company.slug}
          companyName={company.name}
          companyDomain={company.domain}
          existingCredits={progress.upstream}
        />
      </section>

      {/* The few fields a company controls. */}
      <section className="mt-16 border-t border-line pt-10">
        <h2 className="text-xl font-medium tracking-tight">Profile</h2>
        <p className="mt-2 max-w-lg leading-relaxed text-ink-2">
          What you say about yourself. What we observed — the tools spotted on
          your site, the About read from it, your connections — stays as we
          found it, because that is the part a reader can check.
        </p>
        <ProfileForm slug={company.slug} company={company} />
      </section>
    </main>
  );
}
