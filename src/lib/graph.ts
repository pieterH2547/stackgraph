import { listRecentEdges } from "./db/queries";
import { createSimulation, settle, type SimNode } from "./force";
import type { Company, RelationshipEdge } from "./types";

/**
 * Graph geometry. The global graph is laid out the way Obsidian's graph view
 * is — by forces — but the forces are run to rest on the server, so the page
 * ships a finished picture rather than a simulation that settles in front of
 * the reader. The browser only runs them again when somebody drags a node.
 */
export interface GraphNode {
  id: string;
  slug: string;
  name: string;
  domain: string;
  claimed: boolean;
  /** How many edges touch this node. Drives how prominent it looks. */
  degree: number;
  x: number;
  y: number;
  r: number;
}

export interface GraphLink {
  id: string;
  /** Indexes into `nodes`. */
  source: number;
  target: number;
  /** Index in recency order; the newest links draw themselves in. */
  rank: number;
}

export interface GraphView {
  nodes: GraphNode[];
  links: GraphLink[];
  /** The area the settled layout occupies, labels included. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** The point the centring force pulls towards; the browser's drags reuse it. */
  centre: { x: number; y: number };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function nodeRadius(degree: number): number {
  // Mentioned more often -> visually more prominent, but never a blob. The
  // floor is big enough for a favicon to be recognisable inside the disc.
  return Math.min(24, 11 + Math.sqrt(degree) * 3.2);
}

/** Room below each node for its name, so the frame never clips a label. */
const LABEL_ROOM = 22;
const FRAME_PADDING = 28;

/**
 * The global graph: the most recent connections and every company they
 * touch. Nodes start on a phyllotaxis spiral, busiest first, and the forces
 * take it from there. No randomness anywhere, so the same graph gives the
 * same picture on every request.
 */
export async function buildGlobalGraph(limit = 70): Promise<GraphView> {
  const edges = await listRecentEdges(limit);
  return layoutGlobalGraph(edges);
}

export function layoutGlobalGraph(edges: RelationshipEdge[]): GraphView {
  const width = 900;
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

  // A ten-node graph shouldn't sit in the middle of a canvas built for
  // seventy, so the canvas grows with the network instead.
  const height = Math.round(
    Math.min(520, Math.max(260, 180 + ordered.length * 12)),
  );
  const xSpread = width * 0.44;
  const ySpread = height * 0.40;

  const nodes: GraphNode[] = ordered.map((company, index) => {
    const angle = index * GOLDEN_ANGLE;
    // sqrt keeps the spiral evenly dense; the +0.35 offset stops the first few
    // nodes from piling up on the centre point.
    const t =
      ordered.length === 1
        ? 0
        : Math.sqrt((index + 0.35) / (ordered.length - 1 + 0.35));
    const degree = degrees.get(company.id) ?? 0;

    return {
      id: company.id,
      slug: company.slug,
      name: company.name,
      domain: company.domain,
      claimed: company.status === "CLAIMED",
      degree,
      x: width / 2 + Math.cos(angle) * t * xSpread,
      y: height / 2 + Math.sin(angle) * t * ySpread,
      r: nodeRadius(degree),
    };
  });

  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const links: GraphLink[] = [];

  edges.forEach((edge, rank) => {
    const source = indexById.get(edge.source.id);
    const target = indexById.get(edge.target.id);
    if (source === undefined || target === undefined) return;
    links.push({ id: edge.id, source, target, rank });
  });

  // Let the forces settle the spiral into clusters.
  const simNodes: SimNode[] = nodes.map((node) => ({
    x: node.x,
    y: node.y,
    vx: 0,
    vy: 0,
    r: node.r,
    fx: null,
    fy: null,
  }));
  const centre = { x: width / 2, y: height / 2 };
  settle(createSimulation(simNodes, links, centre));
  simNodes.forEach((sim, index) => {
    // Rounded, so the server-rendered markup is short and stable.
    nodes[index].x = Math.round(sim.x * 10) / 10;
    nodes[index].y = Math.round(sim.y * 10) / 10;
  });

  return { nodes, links, viewBox: frame(nodes), centre };
}

/** The bounding box of every disc and its label, with a margin. */
function frame(nodes: GraphNode[]): GraphView["viewBox"] {
  if (nodes.length === 0) return { x: 0, y: 0, width: 900, height: 400 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    // A label is centred under its node and can be wider than the disc.
    const half = Math.max(node.r, 48);
    minX = Math.min(minX, node.x - half);
    maxX = Math.max(maxX, node.x + half);
    minY = Math.min(minY, node.y - node.r);
    maxY = Math.max(maxY, node.y + node.r + LABEL_ROOM);
  }
  return {
    x: Math.floor(minX - FRAME_PADDING),
    y: Math.floor(minY - FRAME_PADDING),
    width: Math.ceil(maxX - minX + FRAME_PADDING * 2),
    height: Math.ceil(maxY - minY + FRAME_PADDING * 2),
  };
}

export interface LocalGraphSide {
  company: Company;
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
