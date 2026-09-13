import Link from "next/link";
import { initials } from "@/lib/format";
import type { GraphView } from "@/lib/graph";

/**
 * The whole recent network in one picture. Busiest companies sit near the
 * middle and are drawn larger, the newest connections draw themselves in when
 * the page loads, and every node is a link into its own local graph.
 *
 * No physics: the layout is computed on the server, so the picture is stable
 * between visits instead of rearranging itself every time.
 */
export function GlobalGraph({ graph }: { graph: GraphView }) {
  const { nodes, links, width, height } = graph;
  if (nodes.length === 0) return null;

  const newest = links.slice(0, 6).map((link) => link.id);
  // While the graph is small, every node gets its name. Past that, only the
  // busy ones, or the labels turn into a hedge.
  const labelAll = nodes.length <= 24;

  return (
    <figure className="overflow-hidden">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          className="block min-w-[640px]"
          role="img"
          aria-label="The independent software graph"
        >
          <g fill="none" stroke="var(--color-line-strong)">
            {links.map((link) => {
              const fresh = newest.includes(link.id);
              return (
                <path
                  key={link.id}
                  d={`M ${link.from.x} ${link.from.y} Q ${
                    (link.from.x + link.to.x) / 2
                  } ${(link.from.y + link.to.y) / 2 - 24} ${link.to.x} ${link.to.y}`}
                  strokeWidth={fresh ? 1.4 : 1}
                  stroke={fresh ? "var(--color-accent)" : undefined}
                  opacity={fresh ? 0.95 : 0.55}
                  className={fresh ? "graph-draw" : undefined}
                />
              );
            })}
          </g>

          {nodes.map((node) => (
            <Link key={node.id} href={`/c/${node.slug}`} className="group">
              <title>{`${node.name} · ${node.domain} · ${node.degree} connection${node.degree === 1 ? "" : "s"}`}</title>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={node.claimed ? "var(--color-ink)" : "var(--color-paper)"}
                stroke={
                  node.claimed
                    ? "var(--color-ink)"
                    : "var(--color-line-strong)"
                }
                strokeWidth={1.5}
                className="transition-[fill,stroke] group-hover:!fill-[var(--color-accent)] group-hover:!stroke-[var(--color-accent)]"
              />
              {node.r >= 12 && (
                <text
                  x={node.x}
                  y={node.y + 3.5}
                  textAnchor="middle"
                  fontSize={Math.min(11, node.r * 0.7)}
                  fontWeight={600}
                  fill={
                    node.claimed ? "var(--color-paper)" : "var(--color-ink-3)"
                  }
                  className="pointer-events-none group-hover:fill-[#fff]"
                >
                  {initials(node.name)}
                </text>
              )}
              {(labelAll || node.degree >= 3) && (
                <text
                  x={node.x}
                  y={node.y + node.r + 13}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--color-ink-2)"
                  className="pointer-events-none"
                >
                  {node.name.length > 14
                    ? `${node.name.slice(0, 13)}…`
                    : node.name}
                </text>
              )}
            </Link>
          ))}
        </svg>
      </div>

      <figcaption className="mono mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-3">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full bg-ink"
          />
          Claimed
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-line-strong"
          />
          Unclaimed
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-px w-5 bg-accent" />
          Just connected
        </span>
        <span>Bigger node, more connections</span>
      </figcaption>
    </figure>
  );
}
