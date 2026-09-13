import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/admin/", "/add/confirm", "/stack/", "/claim/", "/done/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
