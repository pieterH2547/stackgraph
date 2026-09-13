import Link from "next/link";
import { CompanyCard } from "@/components/CompanyCard";
import { EdgeFeed } from "@/components/EdgeFeed";
import { GlobalGraph } from "@/components/GlobalGraph";
import { MonoCount } from "@/components/StatusBadge";
import { brand } from "@/lib/brand";
import { padCount } from "@/lib/format";
import { buildGlobalGraph } from "@/lib/graph";
import {
  getNetworkStats,
  listMostUsedEligible,
  listRecentEdges,
  listRecentlyClaimed,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [stats, edges, claimed, mostUsed, graph] = await Promise.all([
    getNetworkStats(),
    listRecentEdges(10),
    listRecentlyClaimed(4),
    listMostUsedEligible(6),
    buildGlobalGraph(70),
  ]);

  return (
    <main>
      <Hero
        companies={stats.companies}
        relationships={stats.relationships}
        claimed={stats.claimed}
      />

      {graph.nodes.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-12 sm:px-8">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2.5">
            <h2 className="text-xl font-medium tracking-tight">
              {brand.graphHeading}
            </h2>
            <p className="mono text-ink-3">{brand.graphSubline}</p>
          </div>
          <GlobalGraph graph={graph} />
        </section>
      )}

      <section className="mx-auto max-w-6xl px-5 pb-4 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.65fr_1fr] lg:gap-14">
          <div>
            <SectionHead
              title="Recently connected"
              aside={
                edges.length > 0 ? (
                  <MonoCount
                    label="Connections"
                    value={padCount(stats.relationships)}
                  />
                ) : null
              }
            />
            {edges.length > 0 ? (
              <EdgeFeed edges={edges} />
            ) : (
              <p className="max-w-sm text-ink-2">
                Nothing yet. The first company to name its tools shows up here —
                and so do the tools.
              </p>
            )}
          </div>

          <div>
            <SectionHead title="Recently claimed" />
            {claimed.length > 0 ? (
              <div className="grid gap-3">
                {claimed.map((company) => (
                  <CompanyCard key={company.id} company={company} />
                ))}
              </div>
            ) : (
              <p className="max-w-sm text-ink-2">
                No vendor has claimed a profile yet.
              </p>
            )}
          </div>
        </div>
      </section>

      <Manifesto />

      {mostUsed.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-8 sm:px-8">
          <SectionHead
            title="Most used independent tools"
            aside={<span className="mono text-ink-3">Incumbents excluded</span>}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mostUsed.map(({ company, usedBy }) => (
              <CompanyCard key={company.id} company={company} usedBy={usedBy} />
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-5 pb-4 sm:px-8">
        <div className="card flex flex-col items-start justify-between gap-6 p-7 sm:flex-row sm:items-end">
          <div>
            <h2 className="max-w-md text-2xl font-medium tracking-tight sm:text-3xl">
              Give credit to the tools helping you build your software.
            </h2>
            <p className="mono mt-3 text-ink-3">
              One field to start · 1–5 tools · no vendor form
            </p>
          </div>
          <Link href="/add" className="btn btn-primary shrink-0">
            {brand.ctaPrimary}
          </Link>
        </div>
      </section>
    </main>
  );
}

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
    <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
      <h1 className="max-w-4xl text-[clamp(2.5rem,7.5vw,5.25rem)] font-medium leading-[0.95] tracking-[-0.04em]">
        {brand.tagline}
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2 sm:text-xl">
        {brand.subline}
      </p>

      <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Link href="/add" className="btn btn-primary !px-6 !py-3.5 !text-base">
          {brand.ctaPrimary}
        </Link>
        <p className="mono text-ink-2">{brand.heroAside}</p>
      </div>

      {companies > 0 && (
        <p className="mono mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-5 text-ink-3">
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
        </p>
      )}
    </section>
  );
}

function Manifesto() {
  return (
    <section className="my-16 bg-ink py-16 text-paper sm:my-20 sm:py-20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <h2 className="text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            {brand.manifesto.heading}
          </h2>
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

function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2.5">
      <h2 className="text-xl font-medium tracking-tight">{title}</h2>
      {aside}
    </div>
  );
}
