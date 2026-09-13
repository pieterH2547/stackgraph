import type { Metadata } from "next";
import { WebsiteForm } from "@/components/WebsiteForm";
import { submitWebsite } from "@/actions/company";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Add your company",
  description: brand.subline,
};

export default function AddPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="mono text-ink-3">Step 1 of 2</p>
      <h1 className="mt-3 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.035em]">
        Add your company.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-2">
        Paste your website. Next you name the independent tools that help power
        it — that’s the whole thing.
      </p>

      <WebsiteForm action={submitWebsite} />
    </main>
  );
}
