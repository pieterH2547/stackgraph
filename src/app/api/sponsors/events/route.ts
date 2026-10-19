import { after } from "next/server";
import type { NextRequest } from "next/server";
import {
  asksNotToBeTracked,
  cleanPage,
  clientIp,
  recordSponsorEvent,
} from "@/lib/sponsor-events";

export const dynamic = "force-dynamic";

const KINDS = { impression: "IMPRESSION", click: "CLICK" } as const;

/**
 * The beacon the sponsor card sends: once when the card has actually been on
 * screen, once more if it is clicked. Same origin only, a few bytes, answered
 * with 204 before anything is written so the page it came from never waits
 * on this.
 *
 * Every answer is 204, including for a malformed body: a request that cannot
 * be recorded has nothing to learn from the difference, and the browser is
 * not listening either — `sendBeacon` discards the response.
 */
export async function POST(request: NextRequest) {
  const empty = new Response(null, { status: 204 });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 512) return empty;
    body = JSON.parse(text);
  } catch {
    return empty;
  }
  if (typeof body !== "object" || body === null) return empty;

  const { sponsorId, kind, page } = body as Record<string, unknown>;
  if (typeof sponsorId !== "string" || sponsorId.length > 64) return empty;
  if (kind !== "impression" && kind !== "click") return empty;

  const headers = request.headers;
  const event = {
    sponsorId,
    kind: KINDS[kind],
    page: cleanPage(page),
    ip: clientIp(headers),
    userAgent: headers.get("user-agent"),
    untracked: asksNotToBeTracked(headers),
  };

  after(async () => {
    try {
      await recordSponsorEvent(event);
    } catch (error) {
      console.error("[whouseswhat] sponsor event not recorded", error);
    }
  });

  return empty;
}
