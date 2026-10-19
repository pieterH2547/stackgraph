/**
 * A small force-directed layout, the kind Obsidian's graph view uses: linked
 * nodes pull together, every node pushes every other away, a gentle pull
 * holds the whole thing in the middle, and nodes never sit on top of each
 * other.
 *
 * Pure and deterministic — no randomness, no timers — so the server can run
 * it to a settled picture and ship that, and the browser can run the same
 * code again when somebody drags a node. A few hundred nodes at most, so the
 * pairwise forces are computed directly rather than with a quadtree.
 */

export interface SimNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Pinned position while being dragged. */
  fx: number | null;
  fy: number | null;
}

export interface SimLink {
  source: number;
  target: number;
}

export interface ForceOptions {
  /** Rest length of a link, added to both radii. */
  linkDistance: number;
  /** Negative pushes apart. */
  charge: number;
  /** Below this distance the charge stops growing, so close pairs don't explode. */
  chargeDistanceMin: number;
  /** Pull towards the centre, per axis. A stronger y-pull makes a wide layout. */
  centreX: number;
  centreY: number;
  /** Extra space kept between two node edges. */
  collidePadding: number;
  velocityDecay: number;
}

export const DEFAULT_FORCES: ForceOptions = {
  linkDistance: 46,
  charge: -260,
  chargeDistanceMin: 12,
  centreX: 0.035,
  centreY: 0.09,
  // Room for the name under each disc, so a label doesn't run into the next node.
  collidePadding: 18,
  velocityDecay: 0.4,
};

const ALPHA_MIN = 0.001;
/** Same decay as d3: about 300 ticks from 1 to ALPHA_MIN. */
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);

export interface Simulation {
  nodes: SimNode[];
  links: SimLink[];
  alpha: number;
  alphaTarget: number;
  centre: { x: number; y: number };
  options: ForceOptions;
}

export function createSimulation(
  nodes: SimNode[],
  links: SimLink[],
  centre: { x: number; y: number },
  options: Partial<ForceOptions> = {},
): Simulation {
  return {
    nodes,
    links: links.filter(
      (link) =>
        link.source !== link.target &&
        nodes[link.source] !== undefined &&
        nodes[link.target] !== undefined,
    ),
    alpha: 1,
    alphaTarget: 0,
    centre,
    options: { ...DEFAULT_FORCES, ...options },
  };
}

/** True while there is still movement worth animating. */
export function isActive(sim: Simulation): boolean {
  return sim.alpha >= ALPHA_MIN || sim.alphaTarget > 0;
}

/**
 * A deterministic stand-in for d3's random jiggle: two nodes at exactly the
 * same spot still get pushed apart, in a direction that depends only on
 * which two nodes they are.
 */
function jiggle(i: number, j: number): number {
  return (((i * 31 + j * 17) % 13) - 6) * 1e-6 || 1e-6;
}

export function tick(sim: Simulation): void {
  const { nodes, links, options: o } = sim;
  sim.alpha += (sim.alphaTarget - sim.alpha) * ALPHA_DECAY;
  const alpha = sim.alpha;
  const n = nodes.length;

  // Links: each pulls its two ends towards the rest length. The bias makes a
  // hub move less than the leaf hanging off it, as in d3.
  const degree = new Array<number>(n).fill(0);
  for (const link of links) {
    degree[link.source] += 1;
    degree[link.target] += 1;
  }
  links.forEach((link, index) => {
    const s = nodes[link.source];
    const t = nodes[link.target];
    let dx = t.x + t.vx - s.x - s.vx;
    let dy = t.y + t.vy - s.y - s.vy;
    if (dx === 0) dx = jiggle(link.source, index);
    if (dy === 0) dy = jiggle(link.target, index);
    const length = Math.sqrt(dx * dx + dy * dy);
    const rest = o.linkDistance + s.r + t.r;
    const strength =
      1 / Math.max(1, Math.min(degree[link.source], degree[link.target]));
    const k = ((length - rest) / length) * alpha * strength;
    dx *= k;
    dy *= k;
    const bias = degree[link.source] / (degree[link.source] + degree[link.target]);
    t.vx -= dx * bias;
    t.vy -= dy * bias;
    s.vx += dx * (1 - bias);
    s.vy += dy * (1 - bias);
  });

  // Charge: everything repels everything, falling off with distance squared.
  const min2 = o.chargeDistanceMin * o.chargeDistanceMin;
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      if (dx === 0) dx = jiggle(i, j);
      if (dy === 0) dy = jiggle(j, i);
      let d2 = dx * dx + dy * dy;
      if (d2 < min2) d2 = Math.sqrt(min2 * d2);
      const w = (o.charge * alpha) / d2;
      a.vx += dx * w;
      a.vy += dy * w;
      b.vx -= dx * w;
      b.vy -= dy * w;
    }
  }

  // Centre: a soft pull per axis, stronger vertically for a wide picture.
  for (const node of nodes) {
    node.vx += (sim.centre.x - node.x) * o.centreX * alpha;
    node.vy += (sim.centre.y - node.y) * o.centreY * alpha;
  }

  // Collision: two discs that overlap are pushed apart along their axis.
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x + b.vx - a.x - a.vx;
      let dy = b.y + b.vy - a.y - a.vy;
      if (dx === 0) dx = jiggle(i, j);
      if (dy === 0) dy = jiggle(j, i);
      const reach = a.r + b.r + o.collidePadding;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      const push = ((reach - d) / d) * 0.5 * 0.7;
      dx *= push;
      dy *= push;
      a.vx -= dx;
      a.vy -= dy;
      b.vx += dx;
      b.vy += dy;
    }
  }

  for (const node of nodes) {
    if (node.fx !== null && node.fy !== null) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= 1 - o.velocityDecay;
    node.vy *= 1 - o.velocityDecay;
    node.x += node.vx;
    node.y += node.vy;
  }
}

/** Runs to rest, or for at most `maxTicks`. For the server's first picture. */
export function settle(sim: Simulation, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && isActive(sim); i++) tick(sim);
}

/** Wakes the simulation up, for a drag. */
export function reheat(sim: Simulation, target = 0.3): void {
  sim.alphaTarget = target;
  if (sim.alpha < target) sim.alpha = target;
}

export function cool(sim: Simulation): void {
  sim.alphaTarget = 0;
}
