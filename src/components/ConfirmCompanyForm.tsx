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
 */
export function ConfirmCompanyForm({
  action,
  detected,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  detected: DetectedFields;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [name, setName] = useState(detected.name);
  const [logoUrl, setLogoUrl] = useState(detected.logoUrl ?? "");
  const [showLogoField, setShowLogoField] = useState(false);

  return (
    <form action={formAction} className="mt-8 max-w-xl">
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
          defaultValue={detected.description ?? ""}
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
          defaultValue={detected.category ?? ""}
        >
          <option value="">Not sure yet</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      {state.error && (
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm text-accent-ink">
          {state.error}
        </p>
      )}

      <div className="mt-7">
        <Submit />
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Saving…" : "That's us — continue"}
    </button>
  );
}
