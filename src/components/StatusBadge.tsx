import type { CompanyStatus } from "@/lib/types";

export function StatusBadge({
  status,
  className = "",
}: {
  status: CompanyStatus;
  className?: string;
}) {
  const claimed = status === "CLAIMED";
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 ${
        claimed
          ? "border-ink bg-ink text-paper"
          : "border-line-strong bg-transparent text-ink-3"
      } ${className}`}
    >
      {claimed ? "CLAIMED" : "UNCLAIMED"}
    </span>
  );
}

/** `USED BY 04` style metadata. */
export function MonoCount({ label, value }: { label: string; value: string }) {
  return (
    <span className="mono text-ink-3">
      {label} <span className="text-ink">{value}</span>
    </span>
  );
}

