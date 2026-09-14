"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sendSignInLink, startGoogleSignIn, type SignInState } from "@/actions/auth";

/**
 * Two doors, no password. Google first because it is one click, the link
 * second because it always works — including for somebody whose work account
 * is not Google.
 */
export function SignInForm({
  intent,
  googleAvailable,
  suggestedDomain,
}: {
  intent: string;
  googleAvailable: boolean;
  suggestedDomain: string;
}) {
  const [state, action] = useActionState<SignInState, FormData>(
    sendSignInLink,
    {},
  );

  return (
    <div className="mt-8">
      {googleAvailable && (
        <form action={startGoogleSignIn.bind(null, intent)}>
          <GoogleButton />
        </form>
      )}

      {googleAvailable && (
        <p className="mono my-5 text-ink-3">or use a sign-in link</p>
      )}

      <form action={action}>
        <input type="hidden" name="intent" value={intent} />
        <label className="label" htmlFor="signin-email">
          {suggestedDomain ? `Your @${suggestedDomain} address` : "Your email"}
        </label>
        <input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="field"
          placeholder={suggestedDomain ? `you@${suggestedDomain}` : "you@company.com"}
        />
        <div className="mt-4">
          <LinkButton />
        </div>
      </form>

      {state.error && (
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm text-accent-ink">
          {state.error}
        </p>
      )}
      {state.sent && (
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm">
          {state.sent}
        </p>
      )}
    </div>
  );
}

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full">
      {pending ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}

function LinkButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-secondary">
      {pending ? "Sending…" : "Email me a link"}
    </button>
  );
}
