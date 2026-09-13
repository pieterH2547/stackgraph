"use client";

import { useFormStatus } from "react-dom";

/**
 * Somebody else said your company uses their product. You get two words about
 * it. Neither of them touches their claimed status — a claim other people could
 * revoke would make every claim hostage to someone else.
 */
export function RelationshipJudge({
  confirm,
  dispute,
}: {
  confirm: (formData: FormData) => void | Promise<void>;
  dispute: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <span className="flex shrink-0 gap-1.5">
      <form action={confirm}>
        <JudgeButton label="Looks right" />
      </form>
      <form action={dispute}>
        <JudgeButton label="Not accurate" danger />
      </form>
    </span>
  );
}

function JudgeButton({
  label,
  danger = false,
}: {
  label: string;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`mono rounded border px-2 py-1 transition-colors ${
        danger
          ? "border-line-strong text-ink-3 hover:border-accent hover:text-accent"
          : "border-line-strong text-ink-3 hover:border-ink hover:text-ink"
      }`}
    >
      {pending ? "…" : label}
    </button>
  );
}
