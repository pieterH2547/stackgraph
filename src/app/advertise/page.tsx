import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { routes } from "@/lib/routes";
import { absoluteUrl } from "@/lib/url";

export const metadata: Metadata = {
  title: "Advertise",
  description: `One labelled card beside company profiles on ${brand.name}. No rankings for sale, no influence on the graph.`,
  alternates: { canonical: routes.advertise() },
  openGraph: {
    title: `${brand.advertiseCta} · ${brand.name}`,
    description: `One labelled card beside company profiles on ${brand.name}.`,
    url: absoluteUrl(routes.advertise()),
  },
};

/**
 * The offer, in the product's own voice, and the one way to take it up: an
 * email. No form, no account, no price — availability and cost come back in
 * the reply, because the packages are still being tested and a number on a
 * public page is a promise.
 *
 * Half of this page says what sponsorship is not. That is not modesty: the
 * manifesto promises no pay-to-play rankings, and a sponsor who reads this
 * page knows exactly what they are buying and exactly what they are not.
 */
export default function AdvertisePage() {
  const mailto = `mailto:${brand.contactEmail}?subject=${encodeURIComponent(
    `Sponsoring ${brand.name}`,
  )}`;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="mono text-ink-3">{brand.sponsoredLabel}</p>
      <h1 className="mt-2 text-[clamp(1.875rem,5vw,3rem)] font-medium leading-[1.05] tracking-[-0.035em]">
        {brand.advertiseCta}
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-2">
        People come here to find out which software companies use which tools.
        If you build a tool for them, a sponsored card puts your name beside
        the profiles they are reading.
      </p>

      <section className="mt-12 grid gap-10 border-t border-line pt-8 md:grid-cols-2 md:gap-14">
        <div>
          <h2 className="text-xl font-medium tracking-tight">What you get</h2>
          <ul className="mt-3 space-y-2 text-ink-2">
            {[
              "One compact card in the sponsored column beside company profiles: your logo, your name, one line, and a link to your site. The column holds at most three sponsors.",
              "Beside the content on a wide screen, below the profile on a phone. Never in front of the graph.",
              "Optionally limited to the categories your customers are in.",
              "A monthly report: impressions, clicks and click-through rate, with crawlers and repeats filtered out and the raw numbers next to them.",
            ].map((line) => (
              <li key={line} className="flex gap-2.5 leading-relaxed">
                <span aria-hidden className="mono shrink-0 text-ink-3">
                  ·
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-medium tracking-tight">
            What you don&apos;t get
          </h2>
          <ul className="mt-3 space-y-2 text-ink-2">
            {[
              "A place in anyone's stack. Every relationship on the site is a company's own statement about what it uses, and no amount of money adds one.",
              "A better position. Profiles and categories are ordered by what companies said, never by who pays.",
              "A claim, a tick, or a word on your own profile. Sponsoring and claiming are separate things.",
              "A link that pretends to be editorial. Every sponsored link is labelled, and carries rel=\"sponsored\".",
            ].map((line) => (
              <li key={line} className="flex gap-2.5 leading-relaxed">
                <span aria-hidden className="mono shrink-0 text-ink-3">
                  ·
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-14 border-l-2 border-accent pl-5 sm:pl-6">
        <h2 className="text-xl font-medium tracking-tight">How to start</h2>
        <p className="mt-2 max-w-lg leading-relaxed text-ink-2">
          Send one email with your website and a line about who you build for.
          We reply with availability and what it costs. No form, no account,
          no sales call.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <a href={mailto} className="btn btn-primary">
            Email {brand.contactEmail}
          </a>
          <Link
            href={routes.home()}
            className="mono text-ink-2 transition-colors hover:text-accent-ink"
          >
            Back to the graph
          </Link>
        </div>
      </section>

      <p className="mono mt-16 max-w-md leading-relaxed text-ink-3">
        We measure a sponsored card without a cookie. Impressions and clicks
        are counted with a daily-rotating hash so a repeat can be told from a
        new reader; no IP address or browser string is stored.
      </p>
    </main>
  );
}
