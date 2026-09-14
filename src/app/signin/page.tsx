import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/SignInForm";
import { brand } from "@/lib/brand";
import { getCompanyBySlug } from "@/lib/db/queries";
import { routes } from "@/lib/routes";
import { googleConfigured } from "@/lib/auth/google";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

const ERRORS: Record<string, string> = {
  "link-expired": "That link had already been used or expired. Here's another.",
  "state-mismatch": "That sign-in didn't finish safely. Try again.",
  "google-failed": "Google didn't complete the sign-in. Try again, or use a link.",
  "google-unavailable": "Google sign-in isn't set up here. A link works.",
};

/**
 * The only page that asks for anything, and it is never in front of browsing:
 * you get here by choosing to claim, edit or manage. What you were claiming is
 * carried through, so signing in continues that instead of restarting it.
 */
export default async function SignInPage({
  searchParams,
}: PageProps<"/signin">) {
  const query = await searchParams;
  const claimSlug = typeof query.claim === "string" ? query.claim : "";
  const error = typeof query.error === "string" ? ERRORS[query.error] : "";

  const user = await currentUser();
  const company = claimSlug ? await getCompanyBySlug(claimSlug) : null;

  // Already signed in: there is nothing to ask.
  if (user) {
    redirect(company ? routes.manage(company.slug) : routes.dashboard());
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-16 sm:px-8 sm:py-24">
      <p className="mono text-ink-3">
        {company ? `Claiming ${company.domain}` : "Sign in"}
      </p>

      <h1 className="mt-3 text-[clamp(1.875rem,5vw,2.75rem)] font-medium leading-[1.05] tracking-[-0.035em]">
        {company ? `Is ${company.name} yours?` : `Sign in to ${brand.name}.`}
      </h1>

      <p className="mt-4 max-w-md leading-relaxed text-ink-2">
        {company
          ? "Use an address at your company's own domain and you're in straight away. Anything else we check by hand first."
          : "No password. We send a link, or Google vouches for you."}
      </p>

      {error && (
        <p className="mt-5 border-l-2 border-accent pl-3 text-sm text-accent-ink">
          {error}
        </p>
      )}

      <SignInForm
        intent={company?.slug ?? ""}
        googleAvailable={googleConfigured()}
        suggestedDomain={company?.domain ?? ""}
      />

      <p className="mono mt-10 text-ink-3">
        Browsing needs no account.{" "}
        <Link href={routes.network()} className="underline hover:text-accent-ink">
          The network
        </Link>{" "}
        is public, and so is every profile.
      </p>
    </main>
  );
}
