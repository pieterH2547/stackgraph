import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ShareRow } from "@/components/ShareRow";
import { trackShare } from "@/actions/stack";
import { brand } from "@/lib/brand";
import { getCompanyBySlug, listOutgoingEdges } from "@/lib/db/queries";
import { stackShareText } from "@/lib/share";
import { absoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/share/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company) return { title: "Not found" };

  const edges = await listOutgoingEdges(company.id);
  const description = stackShareText(company, edges);

  return {
    title: `${company.name}'s stack`,
    description,
    openGraph: {
      title: `What ${company.name} runs on`,
      description,
      url: absoluteUrl(`/share/${company.slug}`),
    },
  };
}

export default async function SharePage({
  params,
}: PageProps<"/share/[slug]">) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);
  if (!company) notFound();

  const edges = await listOutgoingEdges(company.id);
  const shareUrl = absoluteUrl(`/share/${company.slug}`);

  return (
    <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <article className="card overflow-hidden">
        <div className="flex items-center gap-3.5 border-b border-line p-6 sm:p-8">
          <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-medium tracking-tight sm:text-3xl">
              What {company.name} runs on
            </h1>
            <p className="mono mt-1 text-ink-3">{company.domain}</p>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <p className="mono text-ink-3">Powered by</p>
          {edges.length > 0 ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {edges.map((edge) => (
                <li key={edge.id}>
                  <Link
                    href={`/c/${edge.target.slug}`}
                    className="card card-hover flex items-center gap-3 p-3"
                  >
                    <CompanyLogo
                      name={edge.target.name}
                      logoUrl={edge.target.logoUrl}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium tracking-tight">
                        {edge.target.name}
                      </span>
                      <span className="mono block truncate text-ink-3">
                        {edge.target.domain}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-ink-2">
              {company.name} hasn&apos;t named its tools yet.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-line bg-paper px-6 py-4 sm:px-8">
          <Link href="/" className="mono text-ink-3 hover:text-accent-ink">
            {brand.wordmark}
          </Link>
          <span className="mono text-ink-3">{brand.category}</span>
        </div>
      </article>

      <div className="mt-8">
        <p className="label">Share it</p>
        <ShareRow
          url={shareUrl}
          text={stackShareText(company, edges)}
          onShare={trackShare.bind(null, company.slug)}
        />
      </div>

      <p className="mt-8">
        <Link
          href={`/c/${company.slug}`}
          className="mono text-ink-3 hover:text-accent-ink"
        >
          ← {company.name}&apos;s profile
        </Link>
      </p>
    </main>
  );
}
