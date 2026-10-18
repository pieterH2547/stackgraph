import { after } from "next/server";
import { serveBadge } from "@/lib/badge/serve";

export const dynamic = "force-dynamic";

/**
 * `/badge/<slug>.svg` — the embeddable badge. Everything that matters lives in
 * `lib/badge/serve.ts`, so the tests exercise the same code path; this file
 * only supplies Next's `after`, which records the view once the image is on
 * its way rather than before.
 */
export async function GET(request: Request, ctx: RouteContext<"/badge/[file]">) {
  const { file } = await ctx.params;
  return serveBadge(file, request, { defer: (task) => after(task) });
}
