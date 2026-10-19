"use client";

import { useState } from "react";
import {
  badgeEmbedHtml,
  type BadgeEmbedKind,
} from "@/lib/badge/embed";
import type { BadgeTheme } from "@/lib/badge/svg";

export interface BadgeVariant {
  /** Absolute URL, for the snippet. */
  imageUrl: string;
  /** Same image, as this page loads it — relative, and not counted as a view. */
  previewSrc: string;
  width: number;
  height: number;
}

/**
 * Pick a look, pick whether it links, copy. The snippet is built here from the
 * same function the tests check, so what the owner copies is what we promise.
 */
export function BadgeEmbed({
  variants,
  profileUrl,
  alt,
  onCopy,
}: {
  variants: Record<BadgeTheme, BadgeVariant>;
  profileUrl: string;
  alt: string;
  /** A server action; copying the code is a share like any other. */
  onCopy?: (channel: string) => void | Promise<void>;
}) {
  const [theme, setTheme] = useState<BadgeTheme>("light");
  const [kind, setKind] = useState<BadgeEmbedKind>("linked");
  const [copied, setCopied] = useState(false);

  const variant = variants[theme];
  const code = badgeEmbedHtml({
    kind,
    imageUrl: variant.imageUrl,
    profileUrl,
    alt,
    width: variant.width,
    height: variant.height,
  });

  return (
    <div className="mt-6">
      {/* Preview, on the background it is meant for. */}
      <div
        className={`flex items-center justify-center rounded-lg border border-line p-8 ${
          theme === "dark" ? "bg-ink" : "bg-paper"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the served SVG, exactly as other sites will load it */}
        <img
          key={theme}
          src={variant.previewSrc}
          alt={alt}
          width={variant.width}
          height={variant.height}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
        <fieldset>
          <legend className="label">Look</legend>
          <div className="flex gap-2">
            <Choice
              name="theme"
              value="light"
              checked={theme === "light"}
              onChange={() => setTheme("light")}
            >
              Light
            </Choice>
            <Choice
              name="theme"
              value="dark"
              checked={theme === "dark"}
              onChange={() => setTheme("dark")}
            >
              Dark
            </Choice>
          </div>
        </fieldset>

        <fieldset>
          <legend className="label">Link</legend>
          <div className="flex gap-2">
            <Choice
              name="kind"
              value="linked"
              checked={kind === "linked"}
              onChange={() => setKind("linked")}
            >
              Links to your profile
            </Choice>
            <Choice
              name="kind"
              value="image"
              checked={kind === "image"}
              onChange={() => setKind("image")}
            >
              Image only
            </Choice>
          </div>
        </fieldset>
      </div>

      <p className="mono mt-3 text-ink-3">
        {kind === "linked"
          ? "The link carries rel=nofollow: it is for your readers, not for search engines. Your site, your call — edit it if you decide otherwise."
          : "No link at all. The badge still names the site it comes from."}
      </p>

      <div className="mt-5">
        <p className="label">Embed code</p>
        <pre className="card overflow-x-auto p-4 text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-all text-ink-2">
          <code>{code}</code>
        </pre>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="btn btn-primary !py-2 !text-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                onCopy?.(`badge-${kind}`);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy embed code"}
          </button>
          <span className="mono text-ink-3">
            {variant.width} × {variant.height}
          </span>
        </div>
      </div>
    </div>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`mono cursor-pointer rounded border px-2.5 py-1.5 transition-colors ${
        checked
          ? "border-ink bg-ink text-paper"
          : "border-line-strong text-ink-2 hover:border-ink"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {children}
    </label>
  );
}
