const RESERVED = new Set([
  "add",
  "admin",
  "api",
  "c",
  "claim",
  "done",
  "share",
  "stack",
  "about",
  "new",
  "search",
]);

export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return base || "company";
}

/**
 * Turns a name into a free slug. `taken` answers "is this slug already used".
 */
export async function uniqueSlug(
  desired: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(desired);
  const start = RESERVED.has(base) ? `${base}-hq` : base;

  if (!(await taken(start))) return start;

  for (let n = 2; n < 200; n++) {
    const candidate = `${start}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${start}-${Date.now().toString(36)}`;
}
