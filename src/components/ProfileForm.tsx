"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveProfile, type ManageState } from "@/actions/manage";
import { CATEGORIES } from "@/lib/brand";
import type { Company } from "@/lib/types";

/**
 * The company-controlled fields, and only those. The website is shown but
 * pinned to the same domain: identity, every edge and every claim decision
 * hang off that host, so changing it would silently re-point all of them.
 */
export function ProfileForm({
  slug,
  company,
}: {
  slug: string;
  company: Company;
}) {
  const bound = async (
    state: ManageState,
    formData: FormData,
  ): Promise<ManageState> => saveProfile(slug, state, formData);

  const [state, action] = useActionState<ManageState, FormData>(bound, {});

  return (
    <form action={action} className="mt-6 max-w-xl space-y-5">
      <Field label="Name" name="name" defaultValue={company.name} required />

      <div>
        <label className="label" htmlFor="p-description">
          One line, in your words
        </label>
        <textarea
          id="p-description"
          name="description"
          rows={2}
          maxLength={200}
          defaultValue={company.description ?? ""}
          className="field"
          placeholder="What you build, in one sentence."
        />
      </div>

      <div>
        <label className="label" htmlFor="p-category">
          Category
        </label>
        <select
          id="p-category"
          name="category"
          defaultValue={company.category ?? ""}
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
        defaultValue={company.audience ?? ""}
        placeholder="e.g. small SaaS teams"
      />
      <Field
        label="Built by"
        name="builtBy"
        defaultValue={company.builtBy ?? ""}
        placeholder="e.g. two founders"
      />
      <Field
        label="Logo URL"
        name="logoUrl"
        defaultValue={company.logoUrl ?? ""}
        placeholder="https://…"
      />
      <Field
        label={`Website (stays on ${company.domain})`}
        name="website"
        defaultValue={company.website}
      />

      <div className="flex flex-wrap items-center gap-4">
        <SaveButton />
        {state.error && (
          <p className="text-sm text-accent-ink">{state.error}</p>
        )}
        {state.saved && <p className="mono text-ink-3">{state.saved}</p>}
      </div>
    </form>
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
      <label className="label" htmlFor={`p-${name}`}>
        {label}
      </label>
      <input
        id={`p-${name}`}
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

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? "Saving…" : "Save profile"}
    </button>
  );
}
