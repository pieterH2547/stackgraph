import { brand } from "../brand";

/**
 * The snippet a site owner pastes. Importable from the browser, because the
 * badge page builds it live as the options change.
 *
 * Two shapes, and the owner picks:
 *
 * - linked: the image inside a link to the public profile, with
 *   `rel="nofollow"`. The link is for readers — "who else uses this?" is a
 *   fair question to answer in one click — and nofollow tells search engines
 *   not to count it. Google's spam policies name widely distributed widget
 *   links as a pattern to avoid, and a badge is exactly such a widget; a
 *   backlink nobody asked for is also not what makes this worth embedding.
 * - image: the badge alone. No link at all.
 *
 * Nothing here is hidden, sized to zero, or stuffed with keywords. The alt
 * text says what the picture is and stops.
 */

export type BadgeEmbedKind = "linked" | "image";

const ATTR_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtmlAttr(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ATTR_ESCAPES[char]);
}

/**
 * Deliberately without the number. The count changes; the HTML on somebody
 * else's site does not. The live sentence lives in the SVG's own <title>.
 */
export function badgeAlt(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim() || "this company";
  return `Companies that say they use ${clean}, on ${brand.name}`;
}

export interface BadgeEmbedInput {
  kind: BadgeEmbedKind;
  /** Absolute URL of the SVG. */
  imageUrl: string;
  /** Absolute URL of the public profile, with its badge marker. */
  profileUrl: string;
  alt: string;
  width: number;
  height: number;
}

export function badgeEmbedHtml(input: BadgeEmbedInput): string {
  const img = `<img src="${escapeHtmlAttr(input.imageUrl)}" alt="${escapeHtmlAttr(input.alt)}" width="${input.width}" height="${input.height}" loading="lazy">`;
  if (input.kind === "image") return img;
  return `<a href="${escapeHtmlAttr(input.profileUrl)}" rel="nofollow noopener" target="_blank">${img}</a>`;
}
