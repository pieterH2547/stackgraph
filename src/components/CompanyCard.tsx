import Link from "next/link";
import { CompanyLogo } from "./CompanyLogo";
import { MonoCount, StatusBadge } from "./StatusBadge";
import { padCount } from "@/lib/format";
import type { Company } from "@/lib/types";

export function CompanyCard({
  company,
  usedBy,
  note,
}: {
  company: Company;
  usedBy?: number;
  /** Short mono line under the description, e.g. "+3 this week". */
  note?: string;
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
          {company.networkEligible && (
            <StatusBadge status={company.status} className="shrink-0" />
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-ink-2">
          {company.description ?? company.domain}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {note && <span className="mono text-accent-ink">{note}</span>}
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
  note,
  action,
}: {
  company: Company;
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
          </span>
          <span className="mono block truncate text-ink-3">
            {note ?? company.domain}
          </span>
        </span>
      </Link>
      {action}
      {company.networkEligible && <StatusBadge status={company.status} />}
    </div>
  );
}
