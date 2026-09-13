import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { CompanyEditForm } from "@/components/admin/AdminForms";
import { CompanyInline } from "@/components/CompanyCard";
import { resendInvite, saveCompany } from "@/actions/admin";
import { listClaimsForCompany } from "@/lib/claims";
import {
  getCompanyById,
  listIncomingEdges,
  listOutgoingEdges,
} from "@/lib/db/queries";
import { ELIGIBILITY_REASON_LABEL } from "@/lib/eligibility";
import { timeAgo } from "@/lib/format";
import { listNotifications } from "@/lib/notify";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · company",
  robots: { index: false, follow: false },
};

export default async function AdminCompanyPage({
  params,
}: PageProps<"/admin/[id]">) {
  if (!(await isAdmin())) redirect("/admin");

  const { id } = await params;
  const company = await getCompanyById(id);
  if (!company) notFound();

  const [outgoing, incoming, notifications, claims] = await Promise.all([
    listOutgoingEdges(company.id),
    listIncomingEdges(company.id),
    listNotifications(company.id),
    listClaimsForCompany(company.id),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <p className="mono text-ink-3">
        <Link href="/admin" className="hover:text-accent-ink">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">
        {company.name}
      </h1>
      <p className="mono mt-2 text-ink-3">
        {company.domain} · {company.source} · gen {company.generation} ·{" "}
        <Link href={`/c/${company.slug}`} className="hover:text-accent-ink">
          public profile ↗
        </Link>
      </p>
      <p className="mono mt-1 text-ink-3">
        {ELIGIBILITY_REASON_LABEL[company.eligibilityReason]}
      </p>

      <div className="mt-8">
        <CompanyEditForm
          action={saveCompany.bind(null, company.id)}
          company={company}
        />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="label">Uses ({outgoing.length})</h2>
          <div className="border-t border-line">
            {outgoing.length === 0 && (
              <p className="py-3 text-sm text-ink-3">No outgoing edges.</p>
            )}
            {outgoing.map((edge) => (
              <CompanyInline
                key={edge.id}
                company={edge.target}
                type={edge.type}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="label">Used by ({incoming.length})</h2>
          <div className="border-t border-line">
            {incoming.length === 0 && (
              <p className="py-3 text-sm text-ink-3">No incoming edges.</p>
            )}
            {incoming.map((edge) => (
              <CompanyInline
                key={edge.id}
                company={edge.source}
                type={edge.type}
              />
            ))}
          </div>
        </section>
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="label !mb-0">
            Claim notifications ({notifications.length})
          </h2>
          <ActionButton
            action={resendInvite.bind(null, company.id)}
            label="Send claim invitation now"
            pendingLabel="Sending…"
            variant="secondary"
          />
        </div>

        <div className="mt-4 divide-y divide-line border-t border-line">
          {notifications.length === 0 && (
            <p className="py-3 text-sm text-ink-3">Nothing sent or queued.</p>
          )}
          {notifications.map((notification) => (
            <div key={notification.id} className="py-3">
              <p className="mono text-ink-3">
                {notification.status} · {notification.toEmail ?? "no address"} ·{" "}
                mentions {notification.mentionCountAtSend} ·{" "}
                {timeAgo(notification.createdAt)}
              </p>
              <p className="mt-1 text-sm font-medium">{notification.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-ink-2">
                {notification.body}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="label">Claims ({claims.length})</h2>
        <div className="divide-y divide-line border-t border-line">
          {claims.length === 0 && (
            <p className="py-3 text-sm text-ink-3">No claim attempts.</p>
          )}
          {claims.map((claim) => (
            <p key={claim.id} className="mono py-3 text-ink-3">
              {claim.email} · {claim.name} · {claim.role} ·{" "}
              {claim.domainMatch ? "DOMAIN MATCH" : "NO DOMAIN MATCH"} ·{" "}
              {claim.confirmedAt ? "CONFIRMED" : "PENDING"} ·{" "}
              {timeAgo(claim.createdAt)}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}
