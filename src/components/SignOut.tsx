"use client";

import { useFormStatus } from "react-dom";
import { signOut } from "@/actions/auth";

export function SignOut() {
  return (
    <form action={signOut}>
      <Button />
    </form>
  );
}

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mono text-ink-3 transition-colors hover:text-accent-ink"
    >
      {pending ? "…" : "Sign out"}
    </button>
  );
}
