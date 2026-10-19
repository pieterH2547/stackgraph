import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { routes } from "@/lib/routes";
import { exchangeGoogleCode } from "@/lib/auth/google";
import { addDestination, parseAddDraft, settleAdd } from "@/lib/auth/add";
import { settleOwnership } from "@/lib/auth/claim";
import { applyClaimDraft, parseDraft } from "@/lib/auth/draft";
import { startSession } from "@/lib/auth/session";
import { DRAFT_COOKIE, OAUTH_COOKIE } from "@/lib/auth/start";
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
  const expected = store.get(OAUTH_COOKIE)?.value ?? "";
  store.delete(OAUTH_COOKIE);

  // Read once and clear either way: a draft that outlived a failed or
  // abandoned sign-in must not attach itself to the next one. A claim draft
  // and an add draft share the cookie; each parser refuses the other.
  const rawDraft = store.get(DRAFT_COOKIE)?.value;
  const draft = parseDraft(rawDraft);
  const add = parseAddDraft(rawDraft);
  store.delete(DRAFT_COOKIE);

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

  // Adding a company that is not on the graph yet. Google vouched for the
  // address; settleAdd decides whether it proves the domain.
  if (!intentSlug && add) {
    return NextResponse.redirect(
      new URL(addDestination(await settleAdd({ user, draft: add }), add.domain), url),
    );
  }

  const company = intentSlug ? await getCompanyBySlug(intentSlug) : null;
  if (!company) {
    return NextResponse.redirect(new URL(routes.dashboard(), url));
  }

  const outcome = await settleOwnership({ user, companyId: company.id });

  if (outcome.status === "APPROVED") {
    // Only now, and only for the company the draft was written against.
    await applyClaimDraft(company, draft);
    return NextResponse.redirect(new URL(routes.manage(company.slug), url));
  }
  return NextResponse.redirect(
    new URL(
      `${routes.profile(company.slug)}?claim=${outcome.status.toLowerCase()}&why=${outcome.reason}`,
      url,
    ),
  );
}
