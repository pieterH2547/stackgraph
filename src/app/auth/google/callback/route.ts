import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { routes } from "@/lib/routes";
import { exchangeGoogleCode } from "@/lib/auth/google";
import { settleOwnership } from "@/lib/auth/claim";
import { startSession } from "@/lib/auth/session";
import { upsertUser } from "@/lib/auth/store";
import { getCompanyBySlug } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * Google's redirect lands here.
 *
 * The `state` is checked against a cookie we set before leaving, which is what
 * stops a third party from starting a sign-in and having it complete in
 * somebody else's browser. The claim intent rides inside that same state, so
 * it cannot be tampered with independently of the CSRF check.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  const store = await cookies();
  const expected = store.get("wuw_oauth")?.value ?? "";
  store.delete("wuw_oauth");

  const [nonce, ...intentParts] = state.split(":");
  const intentSlug = intentParts.join(":");

  if (!code || !nonce || !expected || nonce !== expected) {
    return NextResponse.redirect(
      new URL(`${routes.signIn()}?error=state-mismatch`, url),
    );
  }

  const identity = await exchangeGoogleCode(code);
  if (!identity) {
    return NextResponse.redirect(
      new URL(`${routes.signIn()}?error=google-failed`, url),
    );
  }

  const user = await upsertUser({
    email: identity.email,
    name: identity.name,
    imageUrl: identity.imageUrl,
    provider: "google",
  });
  await startSession(user.id);

  const company = intentSlug ? await getCompanyBySlug(intentSlug) : null;
  if (!company) {
    return NextResponse.redirect(new URL(routes.dashboard(), url));
  }

  const outcome = await settleOwnership({ user, companyId: company.id });

  if (outcome.status === "APPROVED") {
    return NextResponse.redirect(new URL(routes.manage(company.slug), url));
  }
  return NextResponse.redirect(
    new URL(
      `${routes.profile(company.slug)}?claim=${outcome.status.toLowerCase()}&why=${outcome.reason}`,
      url,
    ),
  );
}
