"use client";

import { useState } from "react";

/**
 * The share object celebrates the *other* tools, which is what gives the
 * mentioned vendors a reason to engage with it too.
 */
export function ShareRow({
  url,
  text,
  onShare,
}: {
  url: string;
  text: string;
  /** A server action, so a share is recorded like any other funnel step. */
  onShare?: (channel: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  const x = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <a
        href={x}
        target="_blank"
        rel="noreferrer"
        onClick={() => onShare?.("x")}
        className="btn btn-secondary !py-2 !text-sm"
      >
        Share on X
      </a>
      <a
        href={linkedin}
        target="_blank"
        rel="noreferrer"
        onClick={() => onShare?.("linkedin")}
        className="btn btn-secondary !py-2 !text-sm"
      >
        Share on LinkedIn
      </a>
      <button
        type="button"
        className="btn btn-secondary !py-2 !text-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            onShare?.("copy");
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
