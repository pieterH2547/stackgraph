import { NextResponse } from "next/server";
import { routes } from "@/lib/routes";
import { settleOwnership } from "@/lib/auth/claim";
import { applyClaimDraft, parseDraft } from "@/lib/auth/draft";
import { startSession } from "@/lib/auth/session";
import { spendLoginToken, upsertUser } from "@/lib/auth/store";
import { getCompanyById } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/**
 * The email sign-in link lands here.
 *
 * Spending the token is what proves the person can read the mailbox, and it is
 * single use — a link forwarded to somebody else is already spent. After that
 * the claim continues on its own: the company being claimed was stored with
 * the token, so nobody has to start over.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const spent = token ? await spendLoginToken(token) : null;
  if (!spent) {
    return NextResponse.redirect(
      new URL(`${routes.signIn()}?error=link-expired`, url),
    );
  }

  const user = await upsertUser({ email: spent.email, provider: "email" });
  await startSession(user.id);

  if (!spent.intentCompanyId) {
    return NextResponse.redirect(new URL(routes.dashboard(), url));
  }

  const company = await getCompanyById(spent.intentCompanyId);
  if (!company) {
    return NextResponse.redirect(new URL(routes.dashboard(), url));
  }

  const outcome = await settleOwnership({ user, companyId: company.id });

  if (outcome.status === "APPROVED") {
    // Only now. What the claim form collected has been sitting on the token
    // row unapplied, because until this line nobody had proved anything.
    await applyClaimDraft(company, parseDraft(spent.claimDraft));
    return NextResponse.redirect(new URL(routes.manage(company.slug), url));
  }
  return NextResponse.redirect(
    new URL(
      `${routes.profile(company.slug)}?claim=${outcome.status.toLowerCase()}&why=${outcome.reason}`,
      url,
    ),
  );
}
