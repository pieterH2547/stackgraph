import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <p className="mono text-ink-3">404</p>
      <h1 className="mt-3 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        Nothing here.
      </h1>
      <p className="mt-4 max-w-md text-ink-2">
        The company you’re looking for isn’t in the network — or never was.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/network" className="btn btn-secondary">
          Browse the network
        </Link>
        <Link href="/add" className="btn btn-primary">
          Add your company
        </Link>
      </div>
    </main>
  );
}
