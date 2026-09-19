import Link from "next/link";
import { CompanyCard } from "@/components/CompanyCard";
import { CompanyLookup } from "@/components/CompanyLookup";
import { EdgeFeed } from "@/components/EdgeFeed";
import { GlobalGraph } from "@/components/GlobalGraph";
import { MonoCount } from "@/components/StatusBadge";
import { brand } from "@/lib/brand";
import { routes } from "@/lib/routes";
import { padCount } from "@/lib/format";
import { buildGlobalGraph } from "@/lib/graph";
import {
  getNetworkStats,
  listConnectedCompanies,
  listGrowingNetworks,
  listRecentEdges,
  type CompanyWithCounts,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * The page answers one question and then proves it can.
 *
 * Hero: the question, and a field to ask it with. Everything below is the
 * demonstration — real edges, real counts, no placeholders. A section with
 * nothing in it is not rendered rather than rendered empty, because an empty
 * "Explore connections" box says the opposite of what the section is for.
 */
export default async function HomePage() {
  const [stats, edges, connected, growing, graph] = await Promise.all([
    getNetworkStats(),
    listRecentEdges(8),
    listConnectedCompanies(6),
    listGrowingNetworks({ days: 7, limit: 6 }),
    buildGlobalGraph(70),
  ]);

  return (
    <main>
      <Hero
        companies={stats.companies}
        relationships={stats.relationships}
        claimed={stats.claimed}
      />

      {/* 1 — the network is moving, and here is it moving */}
      {edges.length > 0 && (
        <Section
          title="Recently connected"
          aside={
            <MonoCount
              label="Connections"
              value={padCount(stats.relationships)}
            />
          }
        >
          <EdgeFeed edges={edges} />
          <p className="mono mt-4 text-ink-3">
            <Link href={routes.network()} className="hover:text-accent-ink">
              Every connection →
            </Link>
          </p>
        </Section>
      )}

      {/* 2 — both directions, on companies that actually have both */}
      {connected.length > 0 && (
        <Section
          title="Explore connections"
          aside={
            <span className="mono text-ink-3">
              Companies with a network to look at
            </span>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connected.map((company) => (
              <ConnectionCard key={company.id} company={company} />
            ))}
          </div>
        </Section>
      )}

      {/*
        Movement, not merit. A "most used" table would be a popularity contest
        with extra steps, and the same names would sit on top of it forever.
        The query joins the edges themselves, so a seeded profile with none
        cannot appear here however long it has existed.
      */}
      {growing.length > 0 && (
        <Section
          title="Growing networks"
          aside={
            <span className="mono text-ink-3">
              Last 7 days · by new connections
            </span>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {growing.map(({ company, gained, total }) => (
              <CompanyCard
                key={company.id}
                company={company}
                usedBy={total}
                note={`+${gained} this week`}
              />
            ))}
          </div>
        </Section>
      )}

      {graph.nodes.length > 0 && (
        <Section title={brand.graphHeading} aside={
          <span className="mono text-ink-3">{brand.graphSubline}</span>
        }>
          <GlobalGraph graph={graph} />
        </Section>
      )}

      <Manifesto />

      <section className="mx-auto max-w-6xl px-5 pb-4 sm:px-8">
        <div className="card flex flex-col items-start justify-between gap-6 p-7 sm:flex-row sm:items-end">
          <div>
            <h2 className="max-w-md text-2xl font-medium tracking-tight sm:text-3xl">
              Someone is already running on your software.
            </h2>
            <p className="mono mt-3 text-ink-3">{brand.claimPrice}</p>
          </div>
          <Link href={routes.add()} className="btn btn-primary shrink-0">
            {brand.ctaPrimary}
          </Link>
        </div>
      </section>
    </main>
  );
}

/**
 * One field, one question. The claim CTA is deliberately secondary: it is the
 * right action for the small minority of visitors who own one of these
 * companies, and the wrong first thing to ask of everyone else.
 */
function Hero({
  companies,
  relationships,
  claimed,
}: {
  companies: number;
  relationships: number;
  claimed: number;
}) {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-14 pt-14 sm:px-8 sm:pb-16 sm:pt-20">
      <p className="label">{brand.wordmark}</p>
      <h1 className="mt-3 max-w-4xl text-[clamp(2.5rem,7.5vw,5.25rem)] font-medium leading-[0.95] tracking-[-0.04em]">
        {brand.heroHeadline}
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2 sm:text-xl">
        {brand.heroSubline}
      </p>

      <div className="mt-8 max-w-2xl">
        <CompanyLookup placeholder={brand.searchPlaceholder} />

        <div className="mono mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ink-3">
          <span>Try</span>
          {brand.searchExamples.map((example) => (
            <Link
              key={example}
              href={routes.searchFor(example)}
              className="underline decoration-line-strong underline-offset-2 hover:text-accent-ink"
            >
              {example}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link href={routes.add()} className="link-sharp font-medium">
          {brand.ctaPrimary} →
        </Link>
        <span className="mono text-ink-3">{brand.heroAside}</span>
      </div>

      {companies > 0 && (
        <p className="mono mt-9 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-5 text-ink-3">
          <span className="text-ink">{padCount(companies)}</span> companies
          <span aria-hidden className="text-line-strong">
            ·
          </span>
          <span className="text-ink">{padCount(relationships)}</span>{" "}
          connections
          <span aria-hidden className="text-line-strong">
            ·
          </span>
          <span className="text-ink">{padCount(claimed)}</span> claimed
          <span aria-hidden className="text-line-strong">
            ·
          </span>
          <Link href={routes.categories()} className="hover:text-accent-ink">
            browse by category
          </Link>
        </p>
      )}
    </section>
  );
}

/**
 * Both directions on one card, which is the thing this product has and a
 * directory does not. A zero is left off rather than printed: "Uses 0 tools"
 * is a sentence about us, not about them.
 */
function ConnectionCard({ company }: { company: CompanyWithCounts }) {
  return (
    <Link
      href={routes.profile(company.slug)}
      className="card card-hover group flex flex-col gap-3 p-4"
    >
      <span className="truncate font-medium tracking-tight group-hover:text-accent-ink">
        {company.name}
      </span>
      <span className="mono flex flex-col gap-1 text-ink-3">
        {company.incoming > 0 && (
          <span>
            Used by <span className="text-ink">{company.incoming}</span>{" "}
            {company.incoming === 1 ? "company" : "companies"}
          </span>
        )}
        {company.outgoing > 0 && (
          <span>
            Uses <span className="text-ink">{company.outgoing}</span>{" "}
            {company.outgoing === 1 ? "tool" : "tools"}
          </span>
        )}
      </span>
    </Link>
  );
}

function Manifesto() {
  return (
    <section className="my-16 bg-ink py-16 text-paper sm:my-20 sm:py-20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
              {brand.manifesto.heading}
            </h2>
            <p className="mono mt-6 text-paper/50">
              {brand.manifesto.signature}
            </p>
          </div>
          <div>
            <ul className="space-y-3">
              {brand.manifesto.lines.map((line) => (
                <li key={line} className="flex gap-3 text-lg sm:text-xl">
                  <span
                    aria-hidden
                    className="mt-3.5 block h-px w-5 shrink-0 bg-accent"
                  />
                  <span className="text-paper/85">{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-7 border-t border-white/15 pt-6 text-lg font-medium sm:text-xl">
              {brand.manifesto.closer}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-12 sm:px-8">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5">
        <h2 className="text-xl font-medium tracking-tight">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
