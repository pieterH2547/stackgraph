"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CompanyLogo } from "./CompanyLogo";
import { brand } from "@/lib/brand";
import { routes } from "@/lib/routes";
import type { SponsorCardData } from "@/lib/sponsors";
import { withBasePath } from "@/lib/url";

/**
 * The one thing a sponsor gets: a compact card, labelled as what it is.
 *
 * Rendered on the server like everything else, so it takes no layout shift
 * and no extra request to appear. The only client work is the beacon — an
 * IntersectionObserver that fires once the card has been half on screen,
 * and a click handler — both native, both a few bytes, neither on the
 * critical path. No third-party script is loaded for it, ever.
 *
 * The link goes straight to the sponsor with `rel="sponsored"`: what the
 * reader sees on hover is where they will land, and search engines are told
 * the link was paid for.
 */
export function SponsorCard({
  sponsor,
  page,
}: {
  sponsor: SponsorCardData;
  page: string;
}) {
  const ref = useRef<HTMLElement>(null);

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
    <aside ref={ref} aria-label={brand.sponsoredLabel} className="card p-4">
      <p className="mono text-ink-3">{brand.sponsoredLabel}</p>
      <a
        href={sponsor.destinationUrl}
        target="_blank"
        rel="sponsored noopener noreferrer"
        onClick={() => beacon({ sponsorId: sponsor.id, kind: "click", page })}
        className="group mt-3 flex items-start gap-3"
      >
        <CompanyLogo name={sponsor.name} logoUrl={sponsor.logoUrl} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium tracking-tight group-hover:text-accent-ink">
            {sponsor.name}
          </span>
          <span className="mt-0.5 block text-sm leading-snug text-ink-2">
            {sponsor.description}
          </span>
          <span className="mono mt-2 block text-ink-3 group-hover:text-accent-ink">
            Visit ↗
          </span>
        </span>
      </a>
      <p className="mono mt-4 border-t border-line pt-3 text-ink-3">
        <Link href={routes.advertise()} className="hover:text-accent-ink">
          Advertise here
        </Link>
      </p>
    </aside>
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
