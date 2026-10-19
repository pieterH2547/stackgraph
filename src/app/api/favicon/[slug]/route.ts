import type { NextRequest } from "next/server";
import { BOT_USER_AGENT } from "@/lib/brand";
import { getCompanyBySlug } from "@/lib/db/queries";
import {
  allowedFaviconType,
  FAVICON_CACHE,
  FAVICON_MAX_BYTES,
  FAVICON_MISS_CACHE,
  faviconSourceUrl,
} from "@/lib/favicon";

export const dynamic = "force-dynamic";

function miss(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": FAVICON_MISS_CACHE },
  });
}

/**
 * One company's favicon, for the graph. A 404 is a normal answer — the
 * graph draws the company's initials instead — so every failure ends in one,
 * cached briefly so a company without an icon isn't asked about on every
 * page view.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/favicon/[slug]">,
) {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return miss();

  const company = await getCompanyBySlug(slug);
  if (!company) return miss();

  // Tests and CI never reach out to the network.
  if (process.env.DISABLE_SITE_DETECTION === "1") return miss();

  try {
    const response = await fetch(faviconSourceUrl(company.domain), {
      headers: { "user-agent": BOT_USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return miss();

    const type = allowedFaviconType(response.headers.get("content-type"));
    if (!type) return miss();

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > FAVICON_MAX_BYTES) {
      return miss();
    }

    return new Response(bytes, {
      headers: {
        "content-type": type,
        "cache-control": FAVICON_CACHE,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch {
    return miss();
  }
}
