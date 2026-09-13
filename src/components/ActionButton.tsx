"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface ActionState {
  error?: string;
  message?: string;
}

/**
 * A single-button form for actions with no fields — completing a claim,
 * resending an invitation.
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = "primary",
  className = "",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className={className}>
      <Button
        label={label}
        pendingLabel={pendingLabel ?? label}
        variant={variant}
      />
      {state.error && (
        <p className="mt-3 text-sm text-accent-ink">{state.error}</p>
      )}
      {state.message && (
        <p className="mono mt-3 text-ink-3">{state.message}</p>
      )}
    </form>
  );
}

function Button({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`btn ${variant === "primary" ? "btn-primary" : "btn-secondary"}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
