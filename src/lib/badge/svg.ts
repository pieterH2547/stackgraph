import { brand } from "../brand";

/**
 * The badge a software company can put on its own site.
 *
 * It renders one fact — how many companies on the graph say they use this
 * product — in the product's own phrasing, so the badge can never promise more
 * than the profile does. "12 software companies say they use Acme" is twelve
 * statements by twelve companies about their own stacks. It is not "12
 * verified customers", and the badge does not get a second phrasing that would
 * let it drift there.
 *
 * Pure: a name, a count and a theme in, a string out. Everything the renderer
 * writes into the document is escaped here, and nothing in the output can load
 * or run anything — no script, no external reference, no foreignObject.
 */

export type BadgeTheme = "light" | "dark";
export const BADGE_THEMES: readonly BadgeTheme[] = ["light", "dark"];
export const DEFAULT_BADGE_THEME: BadgeTheme = "light";

export function isBadgeTheme(value: unknown): value is BadgeTheme {
  return typeof value === "string" && (BADGE_THEMES as string[]).includes(value);
}

export const BADGE_HEIGHT = 48;

/** Longer than this and the badge stops being compact. Truncated with an ellipsis. */
export const MAX_BADGE_NAME = 28;

export interface BadgeInput {
  name: string;
  /** Non-disputed, non-demo incoming relationships. Zero is rendered honestly. */
  count: number;
  theme?: BadgeTheme;
}

export interface RenderedBadge {
  svg: string;
  width: number;
  height: number;
  /** The sentence the image makes, in full. Also the SVG's <title>. */
  title: string;
}

/* -------------------------------------------------------------------------- */
/* text                                                                       */
/* -------------------------------------------------------------------------- */

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

/**
 * A company name is typed by the company, so it is untrusted input to an
 * image we serve from our domain. Control characters go, whitespace collapses,
 * and the result is bounded. Escaping happens at the point of writing.
 */
export function cleanBadgeName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || "This company";
  if (base.length <= MAX_BADGE_NAME) return base;
  return `${base.slice(0, MAX_BADGE_NAME - 1).trimEnd()}…`;
}

export function formatBadgeCount(count: number): string {
  return Math.max(0, Math.floor(count)).toLocaleString("en-GB");
}

/**
 * The two lines, and the one sentence. One phrasing, the profile's own: the
 * companies *say* they use it. Zero gets no number at all — a badge that says
 * "0 companies" is technically true and reads as a joke, and a badge that
 * rounds up is a lie — so it states the one fact that does hold.
 */
export function badgeCopy(name: string, count: number) {
  const cleanName = cleanBadgeName(name);
  if (count <= 0) {
    return {
      headline: cleanName,
      subline: `on ${brand.name}`,
      title: `${cleanName} is on ${brand.name}, ${brand.category}.`,
    };
  }
  const n = formatBadgeCount(count);
  const headline =
    count === 1 ? "1 software company" : `${n} software companies`;
  const verb = count === 1 ? "says it uses" : "say they use";
  return {
    headline,
    subline: `${verb} ${cleanName}`,
    title: `${headline} on ${brand.name} ${verb} ${cleanName}.`,
  };
}

/** What the badge is, said once inside the image for anyone who asks it. */
export const BADGE_DESCRIPTION = `Self-reported on ${brand.domain}: each company stated its own stack. Not a verified customer list.`;

/* -------------------------------------------------------------------------- */
/* geometry                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * No font is loaded — a badge inside an <img> cannot fetch one — so the text
 * is set in whatever sans and mono the viewer has. Widths are estimated and
 * then pinned with `textLength`, which is how every badge service keeps a
 * layout stable across fonts it cannot see.
 */
const SANS_FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const HEADLINE_SIZE = 15;
const MONO_SIZE = 9.5;
const MONO_SPACING = 1.3;
const WORDMARK_SPACING = 1.9;
const PAD = 14;
const MARK = 18;

function sansWidth(text: string, size: number): number {
  let em = 0;
  for (const char of text) {
    if (/[MW]/.test(char)) em += 0.92;
    else if (/[mw]/.test(char)) em += 0.84;
    else if (/[A-Z0-9]/.test(char)) em += 0.64;
    else if (/[ijlt.,'’]/.test(char)) em += 0.3;
    else if (/[frI]/.test(char)) em += 0.36;
    else if (char === " ") em += 0.28;
    else em += 0.55;
  }
  return em * size;
}

function monoWidth(text: string, size: number, spacing: number): number {
  const chars = [...text].length;
  return chars * size * 0.6 + Math.max(0, chars - 1) * spacing;
}

/* -------------------------------------------------------------------------- */
/* palette                                                                    */
/* -------------------------------------------------------------------------- */

interface Palette {
  surface: string;
  border: string;
  block: string;
  onBlock: string;
  headline: string;
  subline: string;
  accent: string;
}

/** The site's own palette (see globals.css), nothing invented for the badge. */
const PALETTES: Record<BadgeTheme, Palette> = {
  light: {
    surface: "#fffefb",
    border: "#cdc7b8",
    block: "#14130f",
    onBlock: "#f7f5f0",
    headline: "#14130f",
    subline: "#7b766a",
    accent: "#e0380d",
  },
  dark: {
    surface: "#14130f",
    border: "#3a3730",
    block: "#f7f5f0",
    onBlock: "#14130f",
    headline: "#f7f5f0",
    subline: "#a8a294",
    accent: "#e0380d",
  },
};

/* -------------------------------------------------------------------------- */
/* render                                                                     */
/* -------------------------------------------------------------------------- */

export function renderBadge(input: BadgeInput): RenderedBadge {
  const theme = input.theme ?? DEFAULT_BADGE_THEME;
  const p = PALETTES[theme];
  const { headline, subline, title } = badgeCopy(input.name, input.count);
  const sublineUpper = subline.toUpperCase();

  const wordmarkWidth = Math.ceil(
    monoWidth(brand.wordmark, MONO_SIZE, WORDMARK_SPACING),
  );
  const blockWidth = PAD + MARK + 10 + wordmarkWidth + PAD;

  const headlineWidth = Math.ceil(sansWidth(headline, HEADLINE_SIZE));
  const sublineWidth = Math.ceil(monoWidth(sublineUpper, MONO_SIZE, MONO_SPACING));
  const textWidth = Math.max(headlineWidth, sublineWidth);
  const width = blockWidth + PAD + textWidth + PAD;
  const height = BADGE_HEIGHT;

  const textX = blockWidth + PAD;
  const markScale = (MARK / 32).toFixed(4);

  /*
   * No clipPath, and ids that differ per rendering: a page that inlines two
   * badges would otherwise resolve both to the first one's definitions. The
   * brand block is a path with its own two rounded corners instead.
   */
  const r = 8;
  const block = `M${r} 0H${blockWidth}V${height}H${r}A${r} ${r} 0 0 1 0 ${height - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
  const uid = `${theme[0]}${width}${input.count}`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="wuw-t-${uid} wuw-d-${uid}">`,
    `<title id="wuw-t-${uid}">${escapeXml(title)}</title>`,
    `<desc id="wuw-d-${uid}">${escapeXml(BADGE_DESCRIPTION)}</desc>`,
    `<rect width="${width}" height="${height}" rx="${r}" fill="${p.surface}"/>`,
    `<path d="${block}" fill="${p.block}"/>`,
    // The mark from icon.svg, scaled: two squares joined by a corner — the
    // one edge, drawn once, landing on both profiles.
    `<g transform="translate(${PAD} ${(height - MARK) / 2}) scale(${markScale})">`,
    `<rect x="7" y="7" width="8" height="8" rx="2" fill="${p.onBlock}"/>`,
    `<rect x="17" y="17" width="8" height="8" rx="2" fill="${p.accent}"/>`,
    `<path d="M15 11h4a2 2 0 0 1 2 2v4" stroke="${p.onBlock}" stroke-width="1.75" fill="none"/>`,
    `</g>`,
    `<text x="${PAD + MARK + 10}" y="${height / 2 + MONO_SIZE / 2 - 1}" font-family="${MONO_FONT}" font-size="${MONO_SIZE}" font-weight="500" letter-spacing="${WORDMARK_SPACING}" fill="${p.onBlock}" textLength="${wordmarkWidth}" lengthAdjust="spacingAndGlyphs">${escapeXml(brand.wordmark)}</text>`,
    `<text x="${textX}" y="21" font-family="${SANS_FONT}" font-size="${HEADLINE_SIZE}" font-weight="600" letter-spacing="-0.2" fill="${p.headline}" textLength="${headlineWidth}" lengthAdjust="spacingAndGlyphs">${escapeXml(headline)}</text>`,
    `<text x="${textX}" y="36" font-family="${MONO_FONT}" font-size="${MONO_SIZE}" letter-spacing="${MONO_SPACING}" fill="${p.subline}" textLength="${sublineWidth}" lengthAdjust="spacingAndGlyphs">${escapeXml(sublineUpper)}</text>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="7.5" fill="none" stroke="${p.border}"/>`,
    `</svg>`,
  ].join("");

  return { svg, width, height, title };
}
