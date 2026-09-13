"use client";

import { useState } from "react";
import { initials } from "@/lib/format";

const SIZES = {
  sm: "h-8 w-8 text-[0.625rem] rounded-md",
  md: "h-11 w-11 text-xs rounded-lg",
  lg: "h-16 w-16 text-base rounded-xl",
  xl: "h-20 w-20 text-lg rounded-xl",
} as const;

/**
 * Vendor logos come from arbitrary domains and often 404, so a broken image
 * falls back to a monogram rather than a broken-image icon. Logos are the main
 * visual material on the site; they have to be reliable.
 */
export function CompanyLogo({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const classes = SIZES[size];

  if (!logoUrl || failed) {
    return (
      <span
        aria-hidden
        className={`${classes} flex shrink-0 items-center justify-center border border-line bg-paper font-mono font-medium tracking-wide text-ink-3`}
      >
        {initials(name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote logos from any vendor domain
    <img
      src={logoUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${classes} shrink-0 border border-line bg-surface object-contain`}
    />
  );
}
