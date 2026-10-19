import { beforeEach, describe, expect, it } from "vitest";
import { joinedCompany, resetDatabase } from "./helpers";
import { GET } from "@/app/api/favicon/[slug]/route";
import {
  createSimulation,
  isActive,
  reheat,
  settle,
  tick,
  type SimNode,
} from "@/lib/force";
import { allowedFaviconType, faviconSourceUrl } from "@/lib/favicon";
import { layoutGlobalGraph, nodeRadius } from "@/lib/graph";
import type { Company, RelationshipEdge } from "@/lib/types";

function company(id: string, claimed = false): Company {
  return {
    id,
    slug: id,
    name: id.toUpperCase(),
    domain: `${id}.dev`,
    website: `https://${id}.dev`,
    logoUrl: null,
    description: null,
    category: null,
    audience: null,
    builtBy: null,
    status: claimed ? "CLAIMED" : "UNCLAIMED",
    networkEligible: true,
    eligibilityReason: "ASSUMED_INDEPENDENT",
    source: "SEED",
    generation: 0,
    detectedAt: null,
    detectedFrom: null,
    detectedStack: null,
    about: null,
    whatItDoes: [],
    contactEmail: null,
    claimName: null,
    claimRole: null,
    claimVerifiedAt: null,
    claimedAt: null,
    isDemo: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function edge(id: string, source: Company, target: Company): RelationshipEdge {
  return {
    id,
    reportedByCompanyId: source.id,
    state: "SELF_REPORTED",
    edgeKind: "ACQUISITION",
    createdAt: "2026-01-01T00:00:00.000Z",
    source,
    target,
  };
}

/** A hub with spokes, a chain, and an isolated pair: the shapes a real graph has. */
function sampleEdges(): RelationshipEdge[] {
  const hub = company("hub", true);
  const spokes = ["a", "b", "c", "d", "e", "f"].map((id) => company(id));
  const chain = ["p", "q", "r", "s"].map((id) => company(id, id === "q"));
  const [x, y] = [company("x"), company("y")];
  return [
    ...spokes.map((spoke, i) => edge(`h${i}`, spoke, hub)),
    edge("c1", chain[0], chain[1]),
    edge("c2", chain[1], chain[2]),
    edge("c3", chain[2], chain[3]),
    edge("c4", chain[3], hub),
    edge("xy", x, y),
  ];
}

describe("the force layout", () => {
  function grid(n: number): SimNode[] {
    return Array.from({ length: n }, (_, i) => ({
      x: (i % 5) * 3,
      y: Math.floor(i / 5) * 3,
      vx: 0,
      vy: 0,
      r: 12,
      fx: null,
      fy: null,
    }));
  }

  it("is deterministic: the same input settles to the same picture", () => {
    const run = () => {
      const nodes = grid(15);
      settle(createSimulation(nodes, [{ source: 0, target: 1 }], { x: 0, y: 0 }));
      return nodes.map(({ x, y }) => [x, y]);
    };
    expect(run()).toEqual(run());
  });

  it("settles to finite positions with no two discs on top of each other", () => {
    const nodes = grid(20);
    const sim = createSimulation(
      nodes,
      [
        { source: 0, target: 1 },
        { source: 1, target: 2 },
        { source: 3, target: 4 },
      ],
      { x: 0, y: 0 },
    );
    settle(sim);
    expect(isActive(sim)).toBe(false);

    for (const node of nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        expect(d).toBeGreaterThan(nodes[i].r + nodes[j].r - 1);
      }
    }
  });

  it("holds a dragged node exactly where the pointer is, and lets go after", () => {
    const nodes = grid(6);
    const sim = createSimulation(nodes, [{ source: 0, target: 1 }], { x: 0, y: 0 });
    settle(sim);

    reheat(sim);
    nodes[0].fx = 500;
    nodes[0].fy = -200;
    for (let i = 0; i < 30; i++) tick(sim);
    expect(nodes[0].x).toBe(500);
    expect(nodes[0].y).toBe(-200);
    // Its neighbour has been pulled towards it.
    expect(nodes[1].x).toBeGreaterThan(50);

    nodes[0].fx = null;
    nodes[0].fy = null;
    sim.alphaTarget = 0;
    tick(sim);
    expect(nodes[0].x).not.toBe(500);
  });

  it("ignores links that point nowhere or at their own node", () => {
    const nodes = grid(3);
    const sim = createSimulation(
      nodes,
      [
        { source: 0, target: 0 },
        { source: 0, target: 9 },
        { source: 1, target: 2 },
      ],
      { x: 0, y: 0 },
    );
    expect(sim.links).toEqual([{ source: 1, target: 2 }]);
    settle(sim);
    expect(nodes.every((n) => Number.isFinite(n.x))).toBe(true);
  });
});

describe("the global graph", () => {
  it("indexes every link into its nodes and frames every node with its label", () => {
    const graph = layoutGlobalGraph(sampleEdges());
    // hub + six spokes + a chain of four + an isolated pair
    expect(graph.nodes).toHaveLength(13);
    expect(graph.links).toHaveLength(11);

    for (const link of graph.links) {
      expect(graph.nodes[link.source]).toBeDefined();
      expect(graph.nodes[link.target]).toBeDefined();
    }

    const { x, y, width, height } = graph.viewBox;
    for (const node of graph.nodes) {
      expect(node.x - node.r).toBeGreaterThanOrEqual(x);
      expect(node.x + node.r).toBeLessThanOrEqual(x + width);
      expect(node.y - node.r).toBeGreaterThanOrEqual(y);
      expect(node.y + node.r + 22).toBeLessThanOrEqual(y + height);
    }
  });

  it("draws the busiest company largest, and lays out the same way every time", () => {
    const first = layoutGlobalGraph(sampleEdges());
    const second = layoutGlobalGraph(sampleEdges());
    expect(first).toEqual(second);

    const hub = first.nodes.find((node) => node.id === "hub");
    expect(hub?.degree).toBe(7);
    expect(hub?.r).toBe(nodeRadius(7));
    expect(Math.max(...first.nodes.map((node) => node.r))).toBe(hub?.r);
    expect(hub?.claimed).toBe(true);
  });

  it("pulls connected companies closer than unconnected ones", () => {
    const graph = layoutGlobalGraph(sampleEdges());
    const at = (id: string) => graph.nodes.find((node) => node.id === id)!;
    const distance = (a: string, b: string) =>
      Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);

    // The isolated pair sit together, and away from the hub's spokes.
    expect(distance("x", "y")).toBeLessThan(distance("x", "a"));
    expect(distance("a", "hub")).toBeLessThan(distance("a", "y"));
  });

  it("is empty when nothing is connected", () => {
    const graph = layoutGlobalGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });
});

describe("favicons", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only ever asks one fixed host, whatever the domain says", () => {
    const url = new URL(faviconSourceUrl("evil.example/../?x=1&domain=other"));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/s2/favicons");
    expect(url.searchParams.get("domain")).toBe("evil.example/../?x=1&domain=other");
    expect(url.searchParams.getAll("domain")).toHaveLength(1);
  });

  it("serves raster images and nothing that can carry script", () => {
    expect(allowedFaviconType("image/png")).toBe("image/png");
    expect(allowedFaviconType("image/x-icon; charset=binary")).toBe("image/x-icon");
    expect(allowedFaviconType("IMAGE/JPEG")).toBe("image/jpeg");
    expect(allowedFaviconType("image/svg+xml")).toBeNull();
    expect(allowedFaviconType("text/html")).toBeNull();
    expect(allowedFaviconType(null)).toBeNull();
  });

  it("answers 404, cached, for unknown slugs, odd slugs, and without the network", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const call = (slug: string) =>
      GET(new Request(`http://localhost/api/favicon/${slug}`) as never, {
        params: Promise.resolve({ slug }),
      });

    for (const slug of ["nobody-here", "../etc/passwd", "UPPER", acme.slug]) {
      const response = await call(slug);
      expect(response.status, slug).toBe(404);
      expect(response.headers.get("cache-control")).toContain("max-age");
    }
  });
});
