"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CompanyLogo } from "./CompanyLogo";
import { brand } from "@/lib/brand";
import { routes } from "@/lib/routes";
import type { SponsorCardData } from "@/lib/sponsors";
import { withBasePath } from "@/lib/url";

/**
 * The sponsored column: a quiet panel, labelled as what it is, holding a
 * short stack of sponsor cards and one dashed slot that says the space is
 * for sale.
 *
 * Rendered on the server like everything else, so it takes no layout shift
 * and no extra request to appear. The only client work is the beacons — an
 * IntersectionObserver per card that fires once the card has been half on
 * screen, and a click handler — both native, both a few bytes, neither on
 * the critical path. No third-party script is loaded for it, ever.
 *
 * Each link goes straight to the sponsor with `rel="sponsored"`: what the
 * reader sees on hover is where they will land, and search engines are told
 * the link was paid for.
 */
export function SponsorPanel({
  sponsors,
  page,
}: {
  sponsors: SponsorCardData[];
  page: string;
}) {
  if (sponsors.length === 0) return null;

  return (
    <aside
      aria-label={brand.sponsoredLabel}
      className="rounded-lg border border-line bg-line/35 p-3"
    >
      <p className="mono px-1 pb-2.5 pt-0.5 text-ink-3">{brand.sponsoredLabel}</p>
      <ul className="space-y-2.5">
        {sponsors.map((sponsor) => (
          <li key={sponsor.id}>
            <SponsorCard sponsor={sponsor} page={page} />
          </li>
        ))}
        <li>
          <Link
            href={routes.advertise()}
            className="mono flex min-h-16 items-center justify-center rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-ink-3 transition-colors hover:border-ink hover:text-ink"
          >
            Advertise here
          </Link>
        </li>
      </ul>
    </aside>
  );
}

/** One sponsor. The whole card is the link. */
function SponsorCard({
  sponsor,
  page,
}: {
  sponsor: SponsorCardData;
  page: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    let sent = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (sent) return;
        if (!entries.some((entry) => entry.intersectionRatio >= 0.5)) return;
        sent = true;
        observer.disconnect();
        beacon({ sponsorId: sponsor.id, kind: "impression", page });
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [sponsor.id, page]);

  return (
    <a
      ref={ref}
      href={sponsor.destinationUrl}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => beacon({ sponsorId: sponsor.id, kind: "click", page })}
      className="card card-hover group block p-3.5"
    >
      <span className="flex items-center gap-2.5">
        <CompanyLogo name={sponsor.name} logoUrl={sponsor.logoUrl} size="sm" />
        <span className="min-w-0 flex-1 truncate font-medium tracking-tight group-hover:text-accent-ink">
          {sponsor.name}
        </span>
        <span aria-hidden className="text-ink-3 group-hover:text-accent-ink">
          ↗
        </span>
      </span>
      <span className="mt-2 line-clamp-2 block text-sm leading-snug text-ink-2">
        {sponsor.description}
      </span>
    </a>
  );
}

/**
 * `sendBeacon` survives the page being left, which is what a click on an
 * outbound link is about to do; `fetch` with `keepalive` is the same promise
 * for browsers without it. Either way this is fire-and-forget.
 */
function beacon(payload: {
  sponsorId: string;
  kind: "impression" | "click";
  page: string;
}) {
  const url = withBasePath("/api/sponsors/events");
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      // A plain-text blob stays a "simple request": no preflight, no CORS
      // dance for a same-origin call.
      navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      return;
    }
    void fetch(url, { method: "POST", body, keepalive: true });
  } catch {
    // Counting is a courtesy to the sponsor, never a reason to break a page.
  }
}
