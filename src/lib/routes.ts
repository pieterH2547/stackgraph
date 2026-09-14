/**
 * Every internal destination in one place, so the one that matters most can be
 * asserted in a test rather than hoped for.
 */
export const routes = {
  home: () => "/",
  network: () => "/network",
  add: () => "/add",
  addConfirm: (website: string) =>
    `/add/confirm?url=${encodeURIComponent(website)}`,
  profile: (slug: string) => `/c/${slug}`,
  stack: (slug: string) => `/stack/${slug}`,
  done: (slug: string) => `/done/${slug}`,
  share: (slug: string) => `/share/${slug}`,
  claim: (slug: string) => `/claim/${slug}`,
  claimFromEmail: (slug: string) => `/claim/${slug}?ref=email`,
  claimVerify: (slug: string, token: string) =>
    `/claim/${slug}/verify?token=${token}`,
  claimExpired: () => "/claim/expired",
  search: () => "/search",
  searchFor: (q: string) => `/search?q=${encodeURIComponent(q)}`,
  categories: () => "/categories",
  category: (category: string) => `/categories/${encodeURIComponent(category)}`,
  signIn: () => "/signin",
  signInFor: (slug: string) => `/signin?claim=${encodeURIComponent(slug)}`,
  dashboard: () => "/dashboard",
  manage: (slug: string) => `/manage/${slug}`,
} as const;

/**
 * The most important redirect in the product. A vendor who has just claimed
 * goes straight back into the flywheel — never to a dashboard.
 */
export function postClaimDestination(slug: string): string {
  return `${routes.stack(slug)}?after=claim`;
}
