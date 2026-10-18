import type { MetadataRoute } from "next";
import { absoluteUrl, noIndex } from "@/lib/url";

export default function robots(): MetadataRoute.Robots {
  if (noIndex()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /*
       * Only what must never be fetched. Everything else that should stay
       * out of the index carries `robots: { index: false }` on the page
       * itself, and a crawler has to be allowed to fetch a page before it
       * can read that. Blocking those here as well was the one combination
       * that does not work: a disallowed URL with inbound links can sit in
       * the index as a bare URL forever, because the noindex telling it to
       * leave was never readable.
       */
      disallow: [
        "/admin",
        "/admin/",
        "/auth/",
        // Route handlers: an unbounded query surface, never a page.
        "/api/",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
