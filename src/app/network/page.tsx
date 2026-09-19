import type { Metadata } from "next";
import Link from "next/link";
import { CompanyCard } from "@/components/CompanyCard";
import { EdgeFeed } from "@/components/EdgeFeed";
import { brand } from "@/lib/brand";
import { padCount } from "@/lib/format";
import { routes } from "@/lib/routes";
import {
  getNetworkGroupCounts,
  getNetworkStats,
  listClaimedCompanies,
  listCreditedCompanies,
  listIncumbentCompanies,
  listRecentEdges,
  listSourcedCompanies,
} from "@/lib/db/queries";

/** How many of each group a page this long can carry without becoming a list. */
const SHOWN = { claimed: 60, credited: 60, sourced: 24, incumbents: 60 };

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The network",
  description: brand.heroSubline,
  alternates: { canonical: "/network" },
};

export default async function NetworkPage() {
  const [stats, totals, claimed, credited, sourced, incumbents, edges] =
    await Promise.all([
      getNetworkStats(),
      getNetworkGroupCounts(),
      listClaimedCompanies(SHOWN.claimed),
      listCreditedCompanies(SHOWN.credited),
      listSourcedCompanies(SHOWN.sourced),
      listIncumbentCompanies(SHOWN.incumbents),
      listRecentEdges(20),
    ]);

  const empty =
    totals.claimed + totals.credited + totals.sourced + totals.incumbents === 0;

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

      {empty ? (
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
            <Section title="Claimed" count={totals.claimed} shown={claimed.length}>
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

          {credited.length > 0 && (
            <Section
              title="Credited, not claimed yet"
              count={totals.credited}
              shown={credited.length}
              aside="Created because someone said they use them"
            >
              <Grid>
                {credited.map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    usedBy={company.incoming}
                  />
                ))}
              </Grid>
            </Section>
          )}

          {sourced.length > 0 && (
            <Section
              title="Sourced, not claimed yet"
              count={totals.sourced}
              shown={sourced.length}
              aside="Public profiles we built, waiting for their owner"
            >
              <Grid>
                {sourced.map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    usedBy={company.incoming}
                  />
                ))}
              </Grid>
              <p className="mt-5 text-ink-2">
                <Link href={routes.categories()} className="link">
                  Browse all {totals.sourced.toLocaleString("en-GB")} by category
                </Link>
              </p>
            </Section>
          )}

          {incumbents.length > 0 && (
            <Section
              title="Big tools in the graph"
              count={totals.incumbents}
              shown={incumbents.length}
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
            <Section
              title="Every connection"
              count={stats.relationships}
              shown={edges.length}
            >
              <EdgeFeed edges={edges} />
            </Section>
          )}
        </>
      )}
    </main>
  );
}

/**
 * `count` is how many there are; `shown` is how many are on the page. Saying
 * only one of the two would either understate the graph or promise a list
 * that isn't there.
 */
function Section({
  title,
  count,
  shown,
  aside,
  children,
}: {
  title: string;
  count: number;
  shown: number;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5">
        <h2 className="text-xl font-medium tracking-tight">
          {title} <span className="mono text-ink-3">{padCount(count)}</span>
          {shown < count && (
            <span className="mono ml-2 text-ink-3">
              showing {padCount(shown)}
            </span>
          )}
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
