import type { Company, RelationshipEdge } from "./types";

function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The share text names the *tools*, not the company doing the sharing. That is
 * what gives the credited vendors a reason to pass it on.
 */
export function stackShareText(
  company: Company,
  edges: RelationshipEdge[],
): string {
  const names = edges.map((edge) => edge.target.name).slice(0, 5);
  if (names.length === 0) {
    return `${company.name} on Smallstack.`;
  }
  return `${company.name} runs on ${joinNames(names)}. Small software powers small software.`;
}
