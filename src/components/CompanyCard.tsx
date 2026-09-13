import Link from "next/link";
import { CompanyLogo } from "./CompanyLogo";
import { MonoCount, RecommendedMark, StatusBadge } from "./StatusBadge";
import { padCount } from "@/lib/format";
import type { Company, RelationshipType } from "@/lib/types";

export function CompanyCard({
  company,
  usedBy,
  type,
}: {
  company: Company;
  usedBy?: number;
  type?: RelationshipType;
}) {
  return (
    <Link
      href={`/c/${company.slug}`}
      className="card card-hover group flex gap-3.5 p-4"
    >
      <CompanyLogo name={company.name} logoUrl={company.logoUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate font-medium tracking-tight group-hover:text-accent-ink">
            {company.name}
          </span>
          <StatusBadge status={company.status} className="shrink-0" />
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-ink-2">
          {company.description ?? company.domain}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {type === "RECOMMENDS" && <RecommendedMark />}
          {usedBy !== undefined && usedBy > 0 && (
            <MonoCount label="Used by" value={padCount(usedBy)} />
          )}
          {company.category && (
            <span className="mono text-ink-3">{company.category}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Compact single-line company reference, used inside stacks and feeds.
 * `note` carries the attribution — who said this relationship exists — because
 * every relationship here is somebody's word until the other end confirms it.
 */
export function CompanyInline({
  company,
  type,
  note,
  action,
}: {
  company: Company;
  type?: RelationshipType;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
      <Link
        href={`/c/${company.slug}`}
        className="group flex min-w-0 flex-1 items-center gap-3"
      >
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium tracking-tight group-hover:text-accent-ink">
              {company.name}
            </span>
            {type === "RECOMMENDS" && (
              <span
                className="mono shrink-0 text-accent-ink"
                title="Recommended"
              >
                <span aria-hidden>♥</span>
              </span>
            )}
          </span>
          <span className="mono block truncate text-ink-3">
            {note ?? company.domain}
          </span>
        </span>
      </Link>
      {action}
      <StatusBadge status={company.status} />
    </div>
  );
}
