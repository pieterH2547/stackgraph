"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CompanyLogo } from "./CompanyLogo";
import { CATEGORIES } from "@/lib/brand";
import type { FormState } from "@/actions/company";

export interface DetectedFields {
  website: string;
  domain: string;
  name: string;
  description: string | null;
  category: string | null;
  logoUrl: string | null;
  detectedAt: string;
  detectedFrom: string;
}

/**
 * "We found this." Five fields, only the name required, all prefilled from the
 * company's own site where we could read it. This is the entire vendor form:
 * no features, no pricing, no positioning essay — what you build and who it's
 * for. Anything we couldn't detect stays blank rather than guessed at.
 *
 * The address comes last, and it has to be on the company's own domain: a
 * company can only add itself. Nothing typed here is published until the link
 * we send to that address is opened.
 */
export function ConfirmCompanyForm({
  action,
  googleAction,
  detected,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Absent when Google sign-in is not configured. */
  googleAction?: (formData: FormData) => Promise<void>;
  detected: DetectedFields;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const was = (field: string, fallback: string) =>
    state.values?.[field] ?? fallback;
  const [name, setName] = useState(detected.name);
  const [logoUrl, setLogoUrl] = useState(detected.logoUrl ?? "");
  const [showLogoField, setShowLogoField] = useState(false);

  return (
    <form action={formAction} key={state.stamp ?? "initial"} className="mt-8 max-w-xl">
      <input type="hidden" name="url" value={detected.website} />
      <input type="hidden" name="detectedAt" value={detected.detectedAt} />
      <input type="hidden" name="detectedFrom" value={detected.detectedFrom} />
      <input type="hidden" name="logoUrl" value={logoUrl} />

      <div className="card flex items-center gap-4 p-4">
        <CompanyLogo name={name} logoUrl={logoUrl || null} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-medium tracking-tight">
            {name || detected.domain}
          </p>
          <p className="mono truncate text-ink-3">{detected.domain}</p>
          <button
            type="button"
            onClick={() => setShowLogoField((open) => !open)}
            className="mono mt-1.5 text-ink-3 underline decoration-line-strong hover:text-accent-ink"
          >
            {showLogoField ? "Hide logo URL" : "Wrong logo?"}
          </button>
        </div>
      </div>

      {showLogoField && (
        <div className="mt-4">
          <label className="label" htmlFor="logoUrlField">
            Logo URL
          </label>
          <input
            id="logoUrlField"
            type="url"
            className="field"
            value={logoUrl}
            placeholder="https://…"
            onChange={(event) => setLogoUrl(event.target.value)}
          />
        </div>
      )}

      <div className="mt-5">
        <label className="label" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={60}
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="mt-4">
        <label className="label" htmlFor="description">
          One line about what it does
        </label>
        <input
          id="description"
          name="description"
          type="text"
          maxLength={180}
          className="field"
          defaultValue={was("description", detected.description ?? "")}
          placeholder="AI customer support for small teams."
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="audience">
            For whom?
          </label>
          <input
            id="audience"
            name="audience"
            type="text"
            maxLength={60}
            className="field"
            defaultValue={was("audience", "")}
            placeholder="Small SaaS teams"
          />
        </div>
        <div>
          <label className="label" htmlFor="builtBy">
            Built by <span className="normal-case">(optional)</span>
          </label>
          <input
            id="builtBy"
            name="builtBy"
            type="text"
            maxLength={60}
            className="field"
            defaultValue={was("builtBy", "")}
            placeholder="Two founders in Ghent"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="label" htmlFor="category">
          Category
        </label>
        <select
          id="category"
          name="category"
          className="field"
          defaultValue={was("category", detected.category ?? "")}
        >
          <option value="">Not sure yet</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <label className="label" htmlFor="add-email">
          Your @{detected.domain} address
        </label>
        <input
          id="add-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="field"
          defaultValue={was("email", "")}
          placeholder={`you@${detected.domain}`}
        />
        <p className="mono mt-2 text-ink-3">
          Only someone at {detected.domain} can add it. We send a link to that
          address; nothing appears on the graph until you open it.
        </p>
      </div>

      {state.error && (
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm text-accent-ink">
          {state.error}
        </p>
      )}
      {state.sent && (
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm">{state.sent}</p>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Submit />
        {googleAction && (
          <>
            <span className="mono text-ink-3">or</span>
            <GoogleButton action={googleAction} />
          </>
        )}
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Sending…" : "That’s us — email me a link"}
    </button>
  );
}

function GoogleButton({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      // Google needs no address typed; it vouches for one.
      formNoValidate
      formAction={action}
      disabled={pending}
      className="btn btn-secondary"
    >
      {pending ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}
