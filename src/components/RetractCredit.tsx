"use client";

import { useFormStatus } from "react-dom";

/**
 * Withdraw a tool you credited by mistake. Your own statement about your own
 * stack, so it is yours to correct — and it needs to be one click, because the
 * alternative is a vendor living with a typo on their public profile forever.
 */
export function RetractCredit({
  toolName,
  action,
}: {
  toolName: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="shrink-0">
      <Button toolName={toolName} />
    </form>
  );
}

function Button({ toolName }: { toolName: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`Remove ${toolName} from our stack`}
      title={`Remove ${toolName} — we don't actually use this`}
      className="mono rounded border border-line-strong px-2 py-1 text-ink-3 transition-colors hover:border-accent hover:text-accent"
    >
      {pending ? "…" : "Remove"}
    </button>
  );
}
