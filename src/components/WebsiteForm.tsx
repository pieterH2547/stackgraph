"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/actions/company";

/** Step 1. One field. */
export function WebsiteForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="mt-8 max-w-xl">
      <label className="label" htmlFor="url">
        Company / product website
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoFocus
          required
          placeholder="acme.com"
          className="field sm:flex-1"
        />
        <Continue />
      </div>

      {state.error && (
        <p className="mt-3 border-l-2 border-accent pl-3 text-sm text-accent-ink">
          {state.error}
        </p>
      )}

      <p className="mono mt-4 text-ink-3">
        That’s the only field. We’ll read the rest from your site.
      </p>
    </form>
  );
}

function Continue() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary shrink-0" disabled={pending}>
      {pending ? "Reading your site…" : "Continue"}
    </button>
  );
}
