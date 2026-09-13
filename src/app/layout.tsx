import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { siteUrl } from "@/lib/url";
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
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.subline,
  openGraph: { siteName: brand.name, type: "website" },
  twitter: { card: "summary_large_image" },
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

function SiteHeader() {
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
          <Link
            href="/network"
            className="mono text-ink-2 transition-colors hover:text-accent-ink"
          >
            The network
          </Link>
          <Link href="/add" className="btn btn-primary !px-3.5 !py-2 !text-sm">
            {brand.ctaPrimary}
          </Link>
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
            href="/network"
            className="mono text-ink-2 transition-colors hover:text-accent-ink"
          >
            Browse
          </Link>
          <span className="mono text-ink-3">{brand.wordmark} · MVP</span>
        </div>
      </div>
    </footer>
  );
}
