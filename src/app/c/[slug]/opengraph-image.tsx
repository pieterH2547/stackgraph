import { ImageResponse } from "next/og";
import { getCompanyBySlug, listOutgoingEdges } from "@/lib/db/queries";
import { brand } from "@/lib/brand";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const PAPER = "#f7f5f0";
const INK = "#14130f";
const INK_3 = "#7b766a";
const ACCENT = "#e0380d";

/**
 * Text only, on purpose: remote vendor logos fail often enough that an OG image
 * depending on them would be a coin flip.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const company = await getCompanyBySlug(slug);

  if (!company) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: PAPER,
            color: INK,
            fontSize: 56,
          }}
        >
          {brand.heroHeadline}
        </div>
      ),
      size,
    );
  }

  const edges = await listOutgoingEdges(company.id);
  const tools = edges.slice(0, 5).map((edge) => edge.target.name);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: INK,
          padding: 72,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 24,
              letterSpacing: 4,
              color: INK_3,
            }}
          >
            <div style={{ width: 18, height: 18, background: ACCENT }} />
            {company.status}
            <span style={{ color: "#cdc7b8" }}>·</span>
            {company.domain}
          </div>

          <div
            style={{
              fontSize: tools.length > 0 ? 84 : 96,
              fontWeight: 600,
              letterSpacing: -3,
              lineHeight: 1,
            }}
          >
            {company.name}
          </div>

          {tools.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 24, letterSpacing: 4, color: INK_3 }}>
                USES
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  fontSize: 38,
                }}
              >
                {tools.map((tool) => (
                  <div
                    key={tool}
                    style={{
                      display: "flex",
                      border: "2px solid #cdc7b8",
                      borderRadius: 10,
                      padding: "8px 18px",
                    }}
                  >
                    {tool}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 26,
            color: INK_3,
            borderTop: "2px solid #e3dfd4",
            paddingTop: 24,
          }}
        >
          <span style={{ letterSpacing: 6 }}>{brand.wordmark}</span>
          <span>{brand.category}</span>
        </div>
      </div>
    ),
    size,
  );
}
