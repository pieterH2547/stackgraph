import Link from "next/link";
import { CompanyLogo } from "./CompanyLogo";
import { timeAgo } from "@/lib/format";
import type { RelationshipEdge } from "@/lib/types";

/**
 * `Acme —uses→ Tally · 12 min ago`. Real edges, in real order. If the network
 * is quiet, this list is short — it is never padded.
 */
export function EdgeFeed({ edges }: { edges: RelationshipEdge[] }) {
  return (
    <ul className="divide-y divide-line">
      {edges.map((edge) => (
        <li
          key={edge.id}
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-3"
        >
          <Link
            href={`/c/${edge.source.slug}`}
            className="flex items-center gap-2 font-medium tracking-tight hover:text-accent-ink"
          >
            <CompanyLogo
              name={edge.source.name}
              logoUrl={edge.source.logoUrl}
              size="sm"
            />
            {edge.source.name}
          </Link>

          <span className="mono shrink-0 text-ink-3">
            {edge.type === "RECOMMENDS" ? "recommends" : "uses"}
          </span>

          <Link
            href={`/c/${edge.target.slug}`}
            className="flex items-center gap-2 font-medium tracking-tight hover:text-accent-ink"
          >
            <CompanyLogo
              name={edge.target.name}
              logoUrl={edge.target.logoUrl}
              size="sm"
            />
            {edge.target.name}
          </Link>

          <span className="mono ml-auto shrink-0 text-ink-3">
            {timeAgo(edge.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
