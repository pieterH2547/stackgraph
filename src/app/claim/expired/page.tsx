import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Link expired",
  robots: { index: false },
};

export default function ExpiredPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
      <h1 className="text-3xl font-medium tracking-tight">
        That link doesn’t work any more.
      </h1>
      <p className="mt-4 max-w-md text-ink-2">
        Claim links last 72 hours. Open your profile and start a fresh one.
      </p>
      <Link href="/network" className="btn btn-primary mt-7">
        Find your profile
      </Link>
    </main>
  );
}
