import type { Metadata } from "next";
import Link from "next/link";
import { CompanyCard } from "@/components/CompanyCard";
import { EdgeFeed } from "@/components/EdgeFeed";
import { brand } from "@/lib/brand";
import { padCount } from "@/lib/format";
import {
  getNetworkStats,
  listCompaniesWithCounts,
  listRecentEdges,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The network",
  description: brand.heroSubline,
  alternates: { canonical: "/network" },
};

export default async function NetworkPage() {
  const [companies, stats, edges] = await Promise.all([
    listCompaniesWithCounts(),
    getNetworkStats(),
    listRecentEdges(20),
  ]);

  const claimed = companies.filter((company) => company.status === "CLAIMED");
  const unclaimed = companies.filter(
    (company) => company.status === "UNCLAIMED" && company.networkEligible,
  );
  const incumbents = companies.filter((company) => !company.networkEligible);

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-[clamp(2rem,5.5vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        The network.
      </h1>
      <p className="mono mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-5 text-ink-3">
        <span className="text-ink">{padCount(stats.companies)}</span> companies
        <span aria-hidden className="text-line-strong">
          ·
        </span>
        <span className="text-ink">{padCount(stats.relationships)}</span>{" "}
        connections
        <span aria-hidden className="text-line-strong">
          ·
        </span>
        <span className="text-ink">{padCount(stats.claimed)}</span> claimed
      </p>

      {companies.length === 0 ? (
        <div className="mt-12 max-w-md">
          <p className="text-lg text-ink-2">
            Nothing here yet. The network starts with one company naming the
            tools it actually uses.
          </p>
          <Link href="/add" className="btn btn-primary mt-6">
            {brand.ctaPrimary}
          </Link>
        </div>
      ) : (
        <>
          {claimed.length > 0 && (
            <Section title="Claimed" count={claimed.length}>
              <Grid>
                {claimed.map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    usedBy={company.incoming}
                  />
                ))}
              </Grid>
            </Section>
          )}

          {unclaimed.length > 0 && (
            <Section
              title="Credited, not claimed yet"
              count={unclaimed.length}
              aside="Created because someone said they use them"
            >
              <Grid>
                {unclaimed.map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    usedBy={company.incoming}
                  />
                ))}
              </Grid>
            </Section>
          )}

          {incumbents.length > 0 && (
            <Section
              title="Big tools in the graph"
              count={incumbents.length}
              aside="Visible as stack data, outside the active network"
            >
              <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4">
                {incumbents.map((company) => (
                  <li key={company.id}>
                    <Link
                      href={`/c/${company.slug}`}
                      className="mono text-ink-2 hover:text-accent-ink"
                    >
                      {company.name}
                      <span className="text-ink-3"> · {company.incoming}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {edges.length > 0 && (
            <Section title="Every connection" count={edges.length}>
              <EdgeFeed edges={edges} />
            </Section>
          )}
        </>
      )}
    </main>
  );
}

function Section({
  title,
  count,
  aside,
  children,
}: {
  title: string;
  count: number;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5">
        <h2 className="text-xl font-medium tracking-tight">
          {title} <span className="mono text-ink-3">{padCount(count)}</span>
        </h2>
        {aside && <span className="mono text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}
