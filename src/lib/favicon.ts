/**
 * Company favicons for the graph, served from our own origin.
 *
 * The browser asks `/api/favicon/<slug>`; the server looks the slug up, asks
 * a favicon service for that company's domain, and hands the bytes back with
 * a long CDN cache. So a visitor never talks to the favicon service or to
 * seventy vendor sites, each icon is fetched once per week rather than once
 * per page view, and the only hosts the server ever contacts are fixed ones —
 * never a URL a user typed.
 */

/** Where the bytes come from. One fixed host, so the route cannot be aimed elsewhere. */
export function faviconSourceUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

/**
 * Raster formats only. SVG is left out on purpose: an SVG served from our
 * origin is a document that can carry script, and a favicon has no need to.
 */
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

export function allowedFaviconType(contentType: string | null): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return ALLOWED_TYPES.has(type) ? type : null;
}

/** A favicon bigger than this is not a favicon. */
export const FAVICON_MAX_BYTES = 64 * 1024;

/** A found icon is kept a day in the browser and a week at the edge. */
export const FAVICON_CACHE =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";

/** A missing one is asked about again after a day, not on every view. */
export const FAVICON_MISS_CACHE = "public, max-age=3600, s-maxage=86400";
