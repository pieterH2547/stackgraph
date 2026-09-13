"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ClaimFormState } from "@/actions/claim";

export function ClaimForm({
  action,
  companyName,
}: {
  action: (
    state: ClaimFormState,
    formData: FormData,
  ) => Promise<ClaimFormState>;
  companyName: string;
}) {
  const [state, formAction] = useActionState<ClaimFormState, FormData>(
    action,
    {},
  );

  if (state.sentTo) {
    return (
      <div className="mt-8 max-w-xl">
        <p className="text-lg">
          Sent to <span className="font-medium">{state.sentTo}</span>. Click the
          link and {companyName} is yours.
        </p>
        {state.devLink && (
          <div className="card mt-5 p-4">
            <p className="mono text-ink-3">
              No mail provider configured — link shown for local testing
            </p>
            <a
              href={state.devLink}
              className="link-sharp mt-2 block break-all text-sm"
            >
              {state.devLink}
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 max-w-xl">
      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="field"
          placeholder={`you@${companyName.toLowerCase().replace(/\s+/g, "")}.com`}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="role">
            Role
          </label>
          <input
            id="role"
            name="role"
            type="text"
            required
            className="field"
            placeholder="Founder"
          />
        </div>
      </div>

      <label className="mt-5 flex items-start gap-3 text-sm text-ink-2">
        <input
          type="checkbox"
          name="represents"
          required
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
        />
        <span>I represent {companyName}.</span>
      </label>

      {state.error && (
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm text-accent-ink">
          {state.error}
        </p>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <Submit />
        <p className="mono text-ink-3">Three fields. No sales call.</p>
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Sending…" : "Send me the link"}
    </button>
  );
}
