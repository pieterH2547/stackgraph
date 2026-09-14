import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SignOut } from "@/components/SignOut";
import { brand } from "@/lib/brand";
import { routes } from "@/lib/routes";
import { currentUser } from "@/lib/auth/session";
import { absoluteUrl, noIndex } from "@/lib/url";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl("/")),
  title: {
    default: `${brand.name} — ${brand.heroHeadline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.heroSubline,
  openGraph: { siteName: brand.name, type: "website" },
  twitter: { card: "summary_large_image" },
  // A test mount on a live commercial domain has no business in an index.
  ...(noIndex() ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}

/**
 * Signing in is never in front of browsing, so the header only changes for
 * somebody who already has an account: a way back to their company, instead
 * of an invitation to make one.
 */
async function SiteHeader() {
  const user = await currentUser();

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <span
            aria-hidden
            className="block h-3.5 w-3.5 rounded-sm bg-ink transition-colors group-hover:bg-accent"
          />
          <span className="mono font-medium !tracking-[0.18em] text-ink">
            {brand.wordmark}
          </span>
        </Link>

        <nav className="flex items-center gap-3 sm:gap-5">
          {/* Search first: looking something up is the most common reason
              to be here without an account. Labels shorten before they go. */}
          <Link
            href={routes.search()}
            className="mono text-ink-2 transition-colors hover:text-accent-ink"
          >
            Search
          </Link>
          <Link
            href={routes.categories()}
            className="mono hidden text-ink-2 transition-colors hover:text-accent-ink sm:inline"
          >
            Categories
          </Link>
          <Link
            href={routes.network()}
            className="mono hidden text-ink-2 transition-colors hover:text-accent-ink md:inline"
          >
            The network
          </Link>
          {user ? (
            <>
              <SignOut />
              <Link
                href={routes.dashboard()}
                className="btn btn-primary shrink-0 !px-3.5 !py-2 !text-sm"
              >
                My company
              </Link>
            </>
          ) : (
            <Link
              href="/add"
              className="btn btn-primary shrink-0 !px-3.5 !py-2 !text-sm"
            >
              {brand.ctaPrimary}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-md">
          <p className="text-lg font-medium tracking-tight">
            {brand.footerLine}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-3">
            {brand.footerAside}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href="/add"
            className="mono text-ink-2 transition-colors hover:text-accent-ink"
          >
            {brand.ctaPrimary}
          </Link>
          <Link
            href={routes.categories()}
            className="mono text-ink-2 transition-colors hover:text-accent-ink"
          >
            Categories
          </Link>
          <Link
            href={routes.network()}
            className="mono text-ink-2 transition-colors hover:text-accent-ink"
          >
            The network
          </Link>
          <span className="mono text-ink-3">{brand.wordmark} · MVP</span>
        </div>
      </div>
    </footer>
  );
}
