import Link from "next/link";
import { initials, padCount } from "@/lib/format";
import { buildLocalGraph } from "@/lib/graph";
import type { Company, RelationshipEdge } from "@/lib/types";

/**
 * One company in the middle, who uses it on the left, what powers it on the
 * right. Every node is a link: clicking re-centres the graph on that company,
 * which is how you travel through the network.
 */
export function LocalGraph({
  company,
  incoming,
  outgoing,
}: {
  company: Company;
  incoming: RelationshipEdge[];
  outgoing: RelationshipEdge[];
}) {
  const graph = buildLocalGraph(company, incoming, outgoing);
  const { width, height, centre } = graph;

  if (graph.users.length === 0 && graph.tools.length === 0) return null;

  return (
    <figure className="card mt-10 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <figcaption className="mono text-ink-3">
          Local graph ·{" "}
          <span className="text-ink-2">
            {padCount(incoming.length)} use it · {padCount(outgoing.length)}{" "}
            power it
          </span>
        </figcaption>
        <span className="mono text-ink-3">Click any node to travel</span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          className="block min-w-[560px]"
          role="img"
          aria-label={`Relationship graph around ${company.name}`}
        >
          <g stroke="var(--color-line-strong)" fill="none">
            {graph.users.map((side) => (
              <path
                key={`u-${side.company.id}`}
                d={curve(side.x, side.y, centre.x, centre.y)}
                strokeWidth={1}
              />
            ))}
            {graph.tools.map((side) => (
              <path
                key={`t-${side.company.id}`}
                d={curve(centre.x, centre.y, side.x, side.y)}
                strokeWidth={1}
              />
            ))}
          </g>

          <text
            x={96}
            y={18}
            className="mono"
            fill="var(--color-ink-3)"
            fontSize={11}
            textAnchor="middle"
          >
            USED BY
          </text>
          <text
            x={width - 96}
            y={18}
            className="mono"
            fill="var(--color-ink-3)"
            fontSize={11}
            textAnchor="middle"
          >
            POWERED BY
          </text>

          {graph.users.map((side) => (
            <GraphNodeMark
              key={side.company.id}
              company={side.company}
              x={side.x}
              y={side.y}
              anchor="middle"
            />
          ))}
          {graph.tools.map((side) => (
            <GraphNodeMark
              key={side.company.id}
              company={side.company}
              x={side.x}
              y={side.y}
              anchor="middle"
            />
          ))}

          {/* The centre is where you already are, so it isn't a link. */}
          <g>
            <circle
              cx={centre.x}
              cy={centre.y}
              r={26}
              fill="var(--color-ink)"
              stroke="var(--color-ink)"
            />
            <text
              x={centre.x}
              y={centre.y + 4}
              textAnchor="middle"
              fontSize={12}
              fill="var(--color-paper)"
              fontWeight={600}
            >
              {initials(company.name)}
            </text>
            <text
              x={centre.x}
              y={centre.y + 44}
              textAnchor="middle"
              fontSize={13}
              fill="var(--color-ink)"
              fontWeight={550}
            >
              {company.name}
            </text>
          </g>
        </svg>
      </div>

      {(graph.hiddenUsers > 0 || graph.hiddenTools > 0) && (
        <p className="mono border-t border-line px-4 py-2 text-ink-3">
          {graph.hiddenUsers > 0 && `+${graph.hiddenUsers} more using it`}
          {graph.hiddenUsers > 0 && graph.hiddenTools > 0 && " · "}
          {graph.hiddenTools > 0 && `+${graph.hiddenTools} more powering it`}
        </p>
      )}
    </figure>
  );
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

function GraphNodeMark({
  company,
  x,
  y,
  anchor,
}: {
  company: Company;
  x: number;
  y: number;
  anchor: "middle";
}) {
  const claimed = company.status === "CLAIMED";
  return (
    <Link href={`/c/${company.slug}`} className="group">
      <title>{`${company.name} · ${company.domain}`}</title>
      <circle
        cx={x}
        cy={y}
        r={17}
        fill={claimed ? "var(--color-ink)" : "var(--color-surface)"}
        stroke={claimed ? "var(--color-ink)" : "var(--color-line-strong)"}
        strokeWidth={1.5}
        className="transition-[fill,stroke] group-hover:!fill-[var(--color-accent)] group-hover:!stroke-[var(--color-accent)]"
      />
      <text
        x={x}
        y={y + 4}
        textAnchor={anchor}
        fontSize={10}
        fontWeight={600}
        fill={claimed ? "var(--color-paper)" : "var(--color-ink-3)"}
        className="pointer-events-none group-hover:fill-[#fff]"
      >
        {initials(company.name)}
      </text>
      <text
        x={x}
        y={y + 31}
        textAnchor={anchor}
        fontSize={11.5}
        fill="var(--color-ink-2)"
        className="pointer-events-none"
      >
        {company.name.length > 16
          ? `${company.name.slice(0, 15)}…`
          : company.name}
      </text>
    </Link>
  );
}
