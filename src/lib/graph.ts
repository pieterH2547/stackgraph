import { listRecentEdges } from "./db/queries";
import type { Company, RelationshipEdge } from "./types";

/**
 * Graph geometry, computed on the server so the pages ship a finished picture
 * instead of a physics simulation. Obsidian's feel — nodes, edges, travel by
 * clicking — without five thousand floating dots.
 */
export interface GraphNode {
  id: string;
  slug: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  claimed: boolean;
  /** How many edges touch this node. Drives how prominent it looks. */
  degree: number;
  x: number;
  y: number;
  r: number;
}

export interface GraphLink {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  recommends: boolean;
  /** Index in recency order; the newest links draw themselves in. */
  rank: number;
}

export interface GraphView {
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function radius(degree: number): number {
  // Mentioned more often -> visually more prominent, but never a blob.
  return Math.min(22, 7 + Math.sqrt(degree) * 3.4);
}

/**
 * The global graph: every recent node on a phyllotaxis spiral, busiest first,
 * so hubs land near the middle and nothing overlaps. Deterministic, which means
 * the picture doesn't jump around between requests.
 */
export async function buildGlobalGraph(limit = 70): Promise<GraphView> {
  const edges = await listRecentEdges(limit);

  const width = 900;
  const height = 520;
  const degrees = new Map<string, number>();

  for (const edge of edges) {
    degrees.set(edge.source.id, (degrees.get(edge.source.id) ?? 0) + 1);
    degrees.set(edge.target.id, (degrees.get(edge.target.id) ?? 0) + 1);
  }

  const companies = new Map<string, Company>();
  for (const edge of edges) {
    companies.set(edge.source.id, edge.source);
    companies.set(edge.target.id, edge.target);
  }

  const ordered = [...companies.values()].sort(
    (a, b) =>
      (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const spread = Math.min(width, height) * 0.46;
  const nodes: GraphNode[] = ordered.map((company, index) => {
    const angle = index * GOLDEN_ANGLE;
    const distance = spread * Math.sqrt(index / Math.max(1, ordered.length - 1));
    const degree = degrees.get(company.id) ?? 0;

    return {
      id: company.id,
      slug: company.slug,
      name: company.name,
      domain: company.domain,
      logoUrl: company.logoUrl,
      claimed: company.status === "CLAIMED",
      degree,
      x: width / 2 + Math.cos(angle) * distance,
      y: height / 2 + Math.sin(angle) * distance * 0.62,
      r: radius(degree),
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links: GraphLink[] = [];

  edges.forEach((edge, rank) => {
    const from = byId.get(edge.source.id);
    const to = byId.get(edge.target.id);
    if (!from || !to) return;
    links.push({
      id: edge.id,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      recommends: edge.type === "RECOMMENDS",
      rank,
    });
  });

  return { nodes, links, width, height };
}

export interface LocalGraphSide {
  company: Company;
  recommends: boolean;
  x: number;
  y: number;
}

export interface LocalGraphView {
  centre: { company: Company; x: number; y: number };
  /** Companies that say they use the centre. */
  users: LocalGraphSide[];
  /** Tools the centre says power it. */
  tools: LocalGraphSide[];
  hiddenUsers: number;
  hiddenTools: number;
  width: number;
  height: number;
}

const MAX_PER_SIDE = 6;

/**
 * The local graph: one company in the middle, who uses it on the left, what
 * powers it on the right. Every node is a link, so clicking re-centres the
 * graph on that company — that's the travelling-through-the-network feel.
 */
export function buildLocalGraph(
  company: Company,
  incoming: RelationshipEdge[],
  outgoing: RelationshipEdge[],
): LocalGraphView {
  const width = 760;
  const rows = Math.max(incoming.length, outgoing.length, 1);
  const visibleRows = Math.min(rows, MAX_PER_SIDE);
  const height = Math.max(220, visibleRows * 62 + 40);

  const column = (
    edges: RelationshipEdge[],
    pick: (edge: RelationshipEdge) => Company,
    x: number,
  ): LocalGraphSide[] => {
    const shown = edges.slice(0, MAX_PER_SIDE);
    const step = height / (shown.length + 1);
    return shown.map((edge, index) => ({
      company: pick(edge),
      recommends: edge.type === "RECOMMENDS",
      x,
      y: step * (index + 1),
    }));
  };

  return {
    centre: { company, x: width / 2, y: height / 2 },
    users: column(incoming, (edge) => edge.source, 96),
    tools: column(outgoing, (edge) => edge.target, width - 96),
    hiddenUsers: Math.max(0, incoming.length - MAX_PER_SIDE),
    hiddenTools: Math.max(0, outgoing.length - MAX_PER_SIDE),
    width,
    height,
  };
}
