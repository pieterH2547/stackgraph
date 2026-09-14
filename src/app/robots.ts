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
      disallow: [
        "/admin",
        "/admin/",
        "/add/confirm",
        "/stack/",
        "/claim/",
        "/done/",
        "/manage/",
        "/dashboard",
        "/signin",
        "/auth/",
        // A query surface, not a page worth indexing.
        "/search",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
