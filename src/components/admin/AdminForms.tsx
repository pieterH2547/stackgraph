"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CATEGORIES } from "@/lib/brand";
import type { AdminFormState } from "@/actions/admin";
import type { Company } from "@/lib/types";

type AdminAction = (
  state: AdminFormState,
  formData: FormData,
) => Promise<AdminFormState>;

function Notice({ state }: { state: AdminFormState }) {
  if (state.error) {
    return <p className="mt-3 text-sm text-accent-ink">{state.error}</p>;
  }
  if (state.message) {
    return <p className="mono mt-3 text-ink-3">{state.message}</p>;
  }
  return null;
}

function Save({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary !py-2 !text-sm" disabled={pending}>
      {pending ? "Working…" : label}
    </button>
  );
}

export function AdminLoginForm({ action }: { action: AdminAction }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(
    action,
    {},
  );
  return (
    <form action={formAction} className="mt-8 max-w-sm">
      <label className="label" htmlFor="key">
        Admin key
      </label>
      <div className="flex gap-3">
        <input
          id="key"
          name="key"
          type="password"
          className="field"
          autoComplete="off"
        />
        <Save label="Enter" />
      </div>
      <Notice state={state} />
    </form>
  );
}

/** Cold start. The first 10–20 companies are seeded by hand, then the product
 * is supposed to do the rest. */
export function SeedCompanyForm({ action }: { action: AdminAction }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(
    action,
    {},
  );
  return (
    <form action={formAction} className="card p-5">
      <p className="label">Seed a company</p>
      <div className="grid gap-3 sm:grid-cols-[1.1fr_1fr_1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="seed-url">
            Website
          </label>
          <input id="seed-url" name="url" className="field" placeholder="tally.so" />
        </div>
        <div>
          <label className="label" htmlFor="seed-name">
            Name (optional)
          </label>
          <input id="seed-name" name="name" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="seed-email">
            Contact email
          </label>
          <input
            id="seed-email"
            name="contactEmail"
            type="email"
            className="field"
          />
        </div>
        <Save label="Create" />
      </div>
      <p className="mono mt-3 text-ink-3">
        Seeds go through the same flow as everyone else: unclaimed until they
        show both sides. A contact email is what makes them reachable.
      </p>
      <Notice state={state} />
    </form>
  );
}

export function CompanyEditForm({
  action,
  company,
}: {
  action: AdminAction;
  company: Company;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            className="field"
            defaultValue={company.name}
          />
        </div>
        <div>
          <label className="label" htmlFor="contactEmail">
            Contact email (for claim invitations)
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            className="field"
            defaultValue={company.contactEmail ?? ""}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="label" htmlFor="description">
          Description
        </label>
        <input
          id="description"
          name="description"
          className="field"
          defaultValue={company.description ?? ""}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="category">
            Category
          </label>
          <select
            id="category"
            name="category"
            className="field"
            defaultValue={company.category ?? ""}
          >
            <option value="">None</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            className="field"
            defaultValue={company.status}
          >
            <option value="UNCLAIMED">UNCLAIMED</option>
            <option value="CLAIMED">CLAIMED</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="logoUrl">
            Logo URL
          </label>
          <input
            id="logoUrl"
            name="logoUrl"
            className="field"
            defaultValue={company.logoUrl ?? ""}
          />
        </div>
      </div>

      <label className="mt-4 flex items-start gap-3 text-sm text-ink-2">
        <input
          type="checkbox"
          name="networkEligible"
          defaultChecked={company.networkEligible}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-medium text-ink">networkEligible</span> — when
          off, this company stays visible as stack data but never triggers the
          claim loop.
        </span>
      </label>

      <div className="mt-5">
        <Save />
      </div>
      <Notice state={state} />
    </form>
  );
}
