import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmCompanyForm } from "@/components/ConfirmCompanyForm";
import { confirmCompany } from "@/actions/company";
import { detectSite } from "@/lib/detect";
import { tryNormalizeSiteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm your company",
  robots: { index: false },
};

export default async function ConfirmPage({
  searchParams,
}: PageProps<"/add/confirm">) {
  const params = await searchParams;
  const raw = typeof params.url === "string" ? params.url : "";
  const normalized = tryNormalizeSiteUrl(raw);
  if (!normalized) redirect("/add");

  const detected = await detectSite(normalized.website);

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="mono text-ink-3">Step 1 of 2</p>
      <h1 className="mt-3 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        We found this.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-2">
        {detected.note
          ? `${detected.note} Fill in what's right and carry on.`
          : "Read from your own site. Correct anything that's off."}
      </p>

      <ConfirmCompanyForm
        action={confirmCompany}
        detected={{
          website: detected.website,
          domain: detected.domain,
          name: detected.name,
          description: detected.description,
          category: detected.category,
          logoUrl: detected.logoUrl,
          detectedAt: detected.detectedAt,
          detectedFrom: detected.detectedFrom,
        }}
      />

      <p className="mt-8">
        <Link href="/add" className="mono text-ink-3 hover:text-accent-ink">
          ← Different website
        </Link>
      </p>
    </main>
  );
}
