"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CATEGORIES } from "@/lib/brand";
import { MAX_DESCRIPTION } from "@/lib/limits";
import { sendSignInLink, startGoogleSignIn, type SignInState } from "@/actions/auth";
import type { Company } from "@/lib/types";

/**
 * Two doors, no password. Google because it is one click, the link because it
 * always works — including for somebody whose work account is not Google.
 *
 * When a company is being claimed the same form asks for the profile first and
 * the address last. That order is the point: somebody who has decided to claim
 * will type, and sending them to an empty form after a round trip through
 * their inbox is where most of them stop. Nothing typed here reaches the
 * company's page until the address is proved — see lib/auth/draft.ts.
 *
 * Both buttons submit this one form, so the profile travels through whichever
 * door is used. Google needs no email, hence formNoValidate.
 */
export function SignInForm({
  intent,
  googleAvailable,
  suggestedDomain,
  company,
}: {
  intent: string;
  googleAvailable: boolean;
  suggestedDomain: string;
  /** Present when this is a claim rather than a plain sign-in. */
  company?: Company;
}) {
  const [state, action] = useActionState<SignInState, FormData>(
    sendSignInLink,
    {},
  );

  /*
   * What was typed wins over what the profile already holds, so a rejected
   * submit comes back filled in. The stamp keys the fields: React resets an
   * uncontrolled form when the action settles, and only a remount picks up
   * the echoed defaults.
   */
  const was = (field: string, fallback: string) =>
    state.values?.[field] ?? fallback;
  const stamp = state.stamp ?? "initial";

  return (
    <div className="mt-8">
      <form action={action} key={stamp} className="space-y-5">
        <input type="hidden" name="intent" value={intent} />

        {company && (
          <>
            <fieldset className="space-y-5">
              <legend className="label mb-1">Your company</legend>

              <Field
                label="Name"
                name="name"
                defaultValue={was("name", company.name)}
                required
              />

              <div>
                <label className="label" htmlFor="c-description">
                  One line, in your words
                </label>
                <textarea
                  id="c-description"
                  name="description"
                  rows={2}
                  maxLength={MAX_DESCRIPTION}
                  defaultValue={was("description", company.description ?? "")}
                  className="field"
                  placeholder="What you build, in one sentence."
                />
              </div>

              <div>
                <label className="label" htmlFor="c-category">
                  Category
                </label>
                <select
                  id="c-category"
                  name="category"
                  defaultValue={was("category", company.category ?? "")}
                  className="field"
                >
                  <option value="">Not set</option>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <Field
                label="Who is it for?"
                name="audience"
                defaultValue={was("audience", company.audience ?? "")}
                placeholder="e.g. small SaaS teams"
              />
              <Field
                label="Built by"
                name="builtBy"
                defaultValue={was("builtBy", company.builtBy ?? "")}
                placeholder="e.g. two founders"
              />
              <Field
                label={`Website (stays on ${company.domain})`}
                name="website"
                defaultValue={was("website", company.website)}
              />
            </fieldset>

            <fieldset className="space-y-5 border-t border-line pt-5">
              <legend className="label mb-1">You</legend>
              <Field
                label="Your name"
                name="claimName"
                defaultValue={was("claimName", company.claimName ?? "")}
                placeholder="Who we're talking to"
              />
              <Field
                label="Your role"
                name="claimRole"
                defaultValue={was("claimRole", company.claimRole ?? "")}
                placeholder="e.g. founder"
              />
            </fieldset>
          </>
        )}

        <div className={company ? "border-t border-line pt-5" : ""}>
          <label className="label" htmlFor="signin-email">
            {suggestedDomain ? `Your @${suggestedDomain} address` : "Your email"}
          </label>
          <input
            id="signin-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state.values?.email ?? ""}
            className="field"
            placeholder={
              suggestedDomain ? `you@${suggestedDomain}` : "you@company.com"
            }
          />
          {company && (
            <p className="mono mt-2 text-ink-3">
              We send a link to confirm it&apos;s you. Nothing above appears on{" "}
              {company.name}&apos;s page until you open it.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <LinkButton claiming={Boolean(company)} />
            {googleAvailable && (
              <>
                <span className="mono text-ink-3">or</span>
                <GoogleButton intent={intent} />
              </>
            )}
          </div>
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

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={`c-${name}`}>
        {label}
      </label>
      <input
        id={`c-${name}`}
        name={name}
        type="text"
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="field"
      />
    </div>
  );
}

function GoogleButton({ intent }: { intent: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      // Google carries the form without needing the email field filled in.
      formNoValidate
      formAction={startGoogleSignIn.bind(null, intent)}
      disabled={pending}
      className="btn btn-secondary"
    >
      {pending ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}

function LinkButton({ claiming }: { claiming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? "Sending…" : claiming ? "Claim and email me a link" : "Email me a link"}
    </button>
  );
}
