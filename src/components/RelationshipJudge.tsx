"use client";

import { useFormStatus } from "react-dom";

/**
 * A company credited your product in its own stack. There is nothing for you
 * to confirm — it is their statement about themselves, not a request — but if
 * you don't recognise them at all, this takes the edge out of the public
 * graph. It never touches their claimed status: a claim other people could
 * revoke would make every claim hostage to someone else.
 */
export function RelationshipJudge({
  dispute,
}: {
  dispute: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={dispute} className="shrink-0">
      <DisputeButton />
    </form>
  );
}

function DisputeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      title="We don’t recognise this company as a user"
      disabled={pending}
      className="mono rounded border border-line-strong px-2 py-1 text-ink-3 transition-colors hover:border-accent hover:text-accent"
    >
      {pending ? "…" : "Not accurate"}
    </button>
  );
}
