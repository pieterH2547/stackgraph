"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CATEGORIES } from "@/lib/brand";
import type { SponsorFormState } from "@/actions/sponsors";
import {
  SPONSOR_DESCRIPTION_MAX,
  SPONSOR_NAME_MAX,
  SPONSOR_PACKAGES,
  type Sponsor,
  type SponsorPackage,
} from "@/lib/sponsors";

type SponsorAction = (
  state: SponsorFormState,
  formData: FormData,
) => Promise<SponsorFormState>;

function Notice({ state }: { state: SponsorFormState }) {
  if (state.error) {
    return <p className="mt-3 text-sm text-accent-ink">{state.error}</p>;
  }
  if (state.message) {
    return <p className="mono mt-3 text-ink-3">{state.message}</p>;
  }
  return null;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-primary !py-2 !text-sm"
      disabled={pending}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

function euros(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/**
 * One form for both creating and editing. Every field maps to a column, and
 * the server validates all of it again — the `maxLength` attributes here are
 * a kindness to the person typing, not the rule.
 */
export function SponsorForm({
  action,
  sponsor,
  submitLabel,
}: {
  action: SponsorAction;
  sponsor?: Sponsor;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<SponsorFormState, FormData>(
    action,
    {},
  );
  const prefix = sponsor ? `s-${sponsor.id.slice(0, 8)}` : "s-new";
  const id = (field: string) => `${prefix}-${field}`;

  return (
    <form action={formAction} className="card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("name")}>
            Company name
          </label>
          <input
            id={id("name")}
            name="name"
            className="field"
            maxLength={SPONSOR_NAME_MAX}
            defaultValue={sponsor?.name ?? ""}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor={id("destination")}>
            Destination URL
          </label>
          <input
            id={id("destination")}
            name="destinationUrl"
            type="url"
            className="field"
            placeholder="https://"
            defaultValue={sponsor?.destinationUrl ?? ""}
            required
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("logo")}>
            Logo URL (https, optional)
          </label>
          <input
            id={id("logo")}
            name="logoUrl"
            type="url"
            className="field"
            placeholder="https://"
            defaultValue={sponsor?.logoUrl ?? ""}
          />
        </div>
        <div>
          <label className="label" htmlFor={id("description")}>
            Description (max {SPONSOR_DESCRIPTION_MAX} characters)
          </label>
          <input
            id={id("description")}
            name="description"
            className="field"
            maxLength={SPONSOR_DESCRIPTION_MAX}
            defaultValue={sponsor?.description ?? ""}
            required
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor={id("package")}>
            Package
          </label>
          <select
            id={id("package")}
            name="package"
            className="field"
            defaultValue={sponsor?.package ?? "SIDEBAR"}
          >
            {(Object.keys(SPONSOR_PACKAGES) as SponsorPackage[]).map((key) => (
              <option key={key} value={key}>
                {SPONSOR_PACKAGES[key].label} · €
                {euros(SPONSOR_PACKAGES[key].monthlyPriceCents)}/mo
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id("price")}>
            Monthly price € (blank = package rate)
          </label>
          <input
            id={id("price")}
            name="monthlyPrice"
            inputMode="decimal"
            className="field"
            defaultValue={euros(sponsor?.monthlyPriceCents ?? null)}
          />
        </div>
        <div>
          <label className="label" htmlFor={id("starts")}>
            Start date
          </label>
          <input
            id={id("starts")}
            name="startsOn"
            type="date"
            className="field"
            defaultValue={sponsor?.startsOn ?? ""}
          />
        </div>
        <div>
          <label className="label" htmlFor={id("ends")}>
            End date (inclusive)
          </label>
          <input
            id={id("ends")}
            name="endsOn"
            type="date"
            className="field"
            defaultValue={sponsor?.endsOn ?? ""}
          />
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="label">
          Categories — tick none to show on every profile
        </legend>
        <div className="grid gap-x-4 gap-y-1.5 text-sm text-ink-2 sm:grid-cols-3">
          {CATEGORIES.map((category) => (
            <label key={category} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="categories"
                value={category}
                defaultChecked={sponsor?.categories?.includes(category) ?? false}
                className="h-4 w-4"
              />
              {category}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("email")}>
            Contact email (theirs, admin only)
          </label>
          <input
            id={id("email")}
            name="contactEmail"
            type="email"
            className="field"
            defaultValue={sponsor?.contactEmail ?? ""}
          />
        </div>
        <div>
          <label className="label" htmlFor={id("notes")}>
            Notes (admin only)
          </label>
          <textarea
            id={id("notes")}
            name="notes"
            className="field"
            rows={2}
            defaultValue={sponsor?.notes ?? ""}
          />
        </div>
      </div>

      <label className="mt-5 flex items-start gap-3 text-sm text-ink-2">
        <input
          type="checkbox"
          name="active"
          defaultChecked={sponsor?.active ?? false}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-medium text-ink">Active</span> — shows on
          profiles while inside the start and end dates. Off keeps the row and
          its report without showing anything.
        </span>
      </label>

      <div className="mt-5">
        <Submit label={submitLabel} />
      </div>
      <Notice state={state} />
    </form>
  );
}

/** Deletion asks once, in the browser, and then goes through the server. */
export function DeleteSponsorButton({
  action,
  name,
}: {
  action: (formData: FormData) => Promise<void>;
  name: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${name} and its report? This cannot be undone.`)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="btn btn-secondary !py-2 !text-sm">
        Delete sponsor
      </button>
    </form>
  );
}
