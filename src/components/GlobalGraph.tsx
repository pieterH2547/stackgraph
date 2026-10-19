"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  cool,
  createSimulation,
  isActive,
  reheat,
  tick,
  type Simulation,
} from "@/lib/force";
import { initials } from "@/lib/format";
import type { GraphView } from "@/lib/graph";
import { withBasePath } from "@/lib/url";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;
/** Zoomed in this far, every node gets its name, as in Obsidian. */
const LABEL_ZOOM = 1.6;
/** Pixels a pointer has to travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
const CLIP_ID = "wuw-graph-favicon-clip";

interface View {
  k: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

const subscribeNothing = () => () => {};

/** False during server render and hydration, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The whole recent network, the way Obsidian draws a vault: a dark canvas,
 * companies as discs carrying their own favicon, connections as thin lines.
 *
 * - Hover or focus a company and it lights up with its connections while
 *   everything else fades back.
 * - Drag a company and the graph pulls along behind it, then settles.
 * - Drag the background to pan; pinch, ⌘/Ctrl + scroll or the buttons to
 *   zoom. Plain scrolling still scrolls the page — a graph that swallows the
 *   scroll wheel at the top of a homepage is a trap.
 * - Zoom in far enough and every company gets its name.
 *
 * The first picture is the server's settled layout, so nothing moves until
 * somebody touches it. Favicons come from our own `/api/favicon` route and
 * fade in over the initials once they have actually loaded, so a company
 * without one keeps its initials rather than an empty disc.
 */
export function GlobalGraph({ graph }: { graph: GraphView }) {
  const { nodes, links, viewBox: frame, centre } = graph;
  const hydrated = useHydrated();
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<View>({ k: 1, x: 0, y: 0 });

  const [positions, setPositions] = useState<Point[]>(() =>
    nodes.map(({ x, y }) => ({ x, y })),
  );
  const [view, setViewState] = useState<View>({ k: 1, x: 0, y: 0 });
  const [focus, setFocus] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  const [interaction, setInteraction] = useState<"idle" | "pan" | "drag">(
    "idle",
  );

  const neighbours = useMemo(() => {
    const sets = nodes.map(() => new Set<number>());
    for (const link of links) {
      sets[link.source].add(link.target);
      sets[link.target].add(link.source);
    }
    return sets;
  }, [nodes, links]);

  const newest = useMemo(
    () => new Set(links.filter((link) => link.rank < 6).map((link) => link.id)),
    [links],
  );

  const applyView = useCallback((next: View) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  /** Zoom by `factor`, keeping the point `at` (in viewBox units) still. */
  const zoomAt = useCallback(
    (at: Point, factor: number) => {
      const current = viewRef.current;
      const k = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
      const scale = k / current.k;
      applyView({
        k,
        x: at.x - (at.x - current.x) * scale,
        y: at.y - (at.y - current.y) * scale,
      });
    },
    [applyView],
  );

  const middle = useMemo(
    () => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }),
    [frame],
  );

  /*
   * Everything that has to see raw pointer and wheel events lives here, as
   * native listeners: the wheel one must be non-passive to stop the page
   * zooming, and a press only becomes a drag after it has moved, so a plain
   * click on a company still follows its link.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let sim: Simulation | null = null;
    let frameRequest: number | null = null;
    const pointers = new Map<number, Point>();
    let pinchDistance: number | null = null;
    let suppressClick = false;
    let gesture: {
      kind: "node" | "background";
      pointerId: number;
      pointerType: string;
      index: number;
      start: Point;
      last: Point;
      moved: boolean;
    } | null = null;

    const toViewBox = (clientX: number, clientY: number): Point | null => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const point = new DOMPoint(clientX, clientY).matrixTransform(
        ctm.inverse(),
      );
      return { x: point.x, y: point.y };
    };

    const toGraph = (clientX: number, clientY: number): Point | null => {
      const point = toViewBox(clientX, clientY);
      if (!point) return null;
      const current = viewRef.current;
      return {
        x: (point.x - current.x) / current.k,
        y: (point.y - current.y) / current.k,
      };
    };

    const step = () => {
      if (!sim) return;
      tick(sim);
      setPositions(sim.nodes.map(({ x, y }) => ({ x, y })));
      frameRequest = isActive(sim) ? requestAnimationFrame(step) : null;
    };

    const animate = () => {
      if (frameRequest === null) frameRequest = requestAnimationFrame(step);
    };

    const ensureSimulation = (): Simulation => {
      if (!sim) {
        sim = createSimulation(
          nodes.map((node) => ({
            x: node.x,
            y: node.y,
            vx: 0,
            vy: 0,
            r: node.r,
            fx: null,
            fy: null,
          })),
          links,
          centre,
        );
        // It arrives settled; only a drag should wake it.
        sim.alpha = 0;
      }
      return sim;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      suppressClick = false;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2) {
        // A second finger turns whatever was happening into a pinch.
        gesture = null;
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        return;
      }
      if (pointers.size > 2) return;

      const target = (event.target as Element).closest<SVGElement>(
        "[data-node]",
      );
      gesture = {
        kind: target ? "node" : "background",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        index: target ? Number(target.dataset.node) : -1,
        start: { x: event.clientX, y: event.clientY },
        last: { x: event.clientX, y: event.clientY },
        moved: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pointers.size === 2 && pinchDistance) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const at = toViewBox((a.x + b.x) / 2, (a.y + b.y) / 2);
        if (at && distance > 0) zoomAt(at, distance / pinchDistance);
        pinchDistance = distance;
        event.preventDefault();
        return;
      }

      if (!gesture || event.pointerId !== gesture.pointerId) return;

      if (!gesture.moved) {
        const travelled = Math.hypot(
          event.clientX - gesture.start.x,
          event.clientY - gesture.start.y,
        );
        if (travelled < DRAG_THRESHOLD) return;
        gesture.moved = true;
        // Captured only now: capturing on press would steal the click from
        // the link underneath.
        try {
          svg.setPointerCapture(event.pointerId);
        } catch {
          // Already released; the move handler copes without it.
        }
        if (gesture.kind === "node") {
          reheat(ensureSimulation());
          setInteraction("drag");
          setFocus(gesture.index);
        } else {
          setInteraction("pan");
        }
      }

      if (gesture.kind === "node") {
        const at = toGraph(event.clientX, event.clientY);
        const node = sim?.nodes[gesture.index];
        if (at && node) {
          node.fx = at.x;
          node.fy = at.y;
          animate();
        }
      } else {
        const unit = svg.getScreenCTM()?.a ?? 1;
        const current = viewRef.current;
        applyView({
          k: current.k,
          x: current.x + (event.clientX - gesture.last.x) / unit,
          y: current.y + (event.clientY - gesture.last.y) / unit,
        });
      }
      gesture.last = { x: event.clientX, y: event.clientY };
    };

    const onPointerEnd = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = null;
      if (!gesture || event.pointerId !== gesture.pointerId) return;

      if (gesture.moved) {
        suppressClick = true;
        if (gesture.kind === "node" && sim) {
          const node = sim.nodes[gesture.index];
          node.fx = null;
          node.fy = null;
          cool(sim);
          animate();
          if (gesture.pointerType === "touch") setFocus(null);
        }
        setInteraction("idle");
      }
      gesture = null;
    };

    // A drag that ends over a company must not also open it.
    const onClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const at = toViewBox(event.clientX, event.clientY);
      if (!at) return;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      zoomAt(at, Math.exp(-clamp(pixels, -50, 50) * 0.01));
    };

    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerEnd);
    svg.addEventListener("pointercancel", onPointerEnd);
    svg.addEventListener("click", onClick, true);
    svg.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerEnd);
      svg.removeEventListener("pointercancel", onPointerEnd);
      svg.removeEventListener("click", onClick, true);
      svg.removeEventListener("wheel", onWheel);
    };
  }, [nodes, links, centre, applyView, zoomAt]);

  if (nodes.length === 0) return null;

  const lit =
    focus === null ? null : new Set<number>([focus, ...neighbours[focus]]);
  const allLabels = nodes.length <= 24 || view.k >= LABEL_ZOOM;
  // Names keep a readable size as you zoom rather than growing with it.
  const labelSize = 11 / Math.sqrt(view.k);

  return (
    <figure>
      {/* The layout is wide, so a phone gets a wide box rather than a tall one. */}
      <div className="relative aspect-[5/4] overflow-hidden rounded-lg bg-ink sm:aspect-auto sm:h-[520px]">
        <svg
          ref={svgRef}
          viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
          preserveAspectRatio="xMidYMid meet"
          className={`block h-full w-full select-none ${
            interaction === "pan" ? "cursor-grabbing" : "cursor-grab"
          }`}
          // Zoomed out, one finger still scrolls the page; zoomed in, it pans.
          style={{ touchAction: view.k > 1 ? "none" : "pan-y" }}
          role="group"
          aria-label="The independent software graph"
        >
          <defs>
            <clipPath id={CLIP_ID} clipPathUnits="objectBoundingBox">
              <circle cx="0.5" cy="0.5" r="0.5" />
            </clipPath>
          </defs>

          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <g>
              {links.map((link) => {
                const a = positions[link.source];
                const b = positions[link.target];
                const fresh = newest.has(link.id);
                const touching =
                  focus !== null &&
                  (link.source === focus || link.target === focus);
                return (
                  <line
                    key={link.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={
                      touching || (fresh && !lit)
                        ? "var(--color-accent)"
                        : "var(--color-paper)"
                    }
                    strokeOpacity={
                      lit ? (touching ? 0.95 : 0.05) : fresh ? 0.75 : 0.2
                    }
                    strokeWidth={touching ? 1.75 : 1}
                    vectorEffect="non-scaling-stroke"
                    className={fresh ? "graph-draw" : undefined}
                    style={{ transition: "stroke-opacity 150ms" }}
                  />
                );
              })}
            </g>

            {nodes.map((node, index) => {
              const at = positions[index];
              const isFocus = focus === index;
              const dim = lit !== null && !lit.has(index);
              const showLabel = lit
                ? lit.has(index)
                : allLabels || node.degree >= 3;
              const icon = node.r * 1.35;
              const hasIcon = loaded.has(index);

              return (
                <Link
                  key={node.id}
                  href={`/c/${node.slug}`}
                  data-node={index}
                  aria-label={`${node.name}, ${node.degree} ${
                    node.degree === 1 ? "connection" : "connections"
                  }`}
                  className="outline-none"
                  style={{
                    opacity: dim ? 0.16 : 1,
                    transition: "opacity 150ms",
                    cursor: interaction === "drag" ? "grabbing" : "pointer",
                  }}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "touch" && interaction === "idle") {
                      setFocus(index);
                    }
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType !== "touch" && interaction !== "drag") {
                      setFocus(null);
                    }
                  }}
                  onFocus={() => setFocus(index)}
                  onBlur={() => setFocus(null)}
                >
                  <g transform={`translate(${at.x} ${at.y})`}>
                    <title>{`${node.name} · ${node.domain}`}</title>
                    {/* The ring says claimed (solid) or not yet (dashed). */}
                    <circle
                      r={node.r + 3.5}
                      fill="none"
                      stroke={
                        isFocus
                          ? "var(--color-accent)"
                          : node.claimed
                            ? "var(--color-paper)"
                            : "var(--color-ink-3)"
                      }
                      strokeWidth={isFocus || node.claimed ? 2 : 1.25}
                      strokeDasharray={
                        isFocus || node.claimed ? undefined : "2.5 3"
                      }
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle r={node.r} fill="var(--color-surface)" />
                    {!hasIcon && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={node.r * 0.62}
                        fontWeight={600}
                        fill="var(--color-ink-3)"
                        className="pointer-events-none font-mono"
                      >
                        {initials(node.name)}
                      </text>
                    )}
                    {hydrated && (
                      // Decorative: the link around it carries the name.
                      <image
                        href={withBasePath(`/api/favicon/${node.slug}`)}
                        x={-icon / 2}
                        y={-icon / 2}
                        width={icon}
                        height={icon}
                        clipPath={`url(#${CLIP_ID})`}
                        preserveAspectRatio="xMidYMid meet"
                        opacity={hasIcon ? 1 : 0}
                        aria-hidden
                        className="pointer-events-none"
                        onLoad={() =>
                          setLoaded((previous) => new Set(previous).add(index))
                        }
                      />
                    )}
                    {showLabel && (
                      <text
                        y={node.r + 8 + labelSize}
                        textAnchor="middle"
                        fontSize={labelSize}
                        fill="var(--color-paper)"
                        fillOpacity={isFocus ? 1 : 0.72}
                        className="pointer-events-none"
                      >
                        {node.name.length > 18
                          ? `${node.name.slice(0, 17)}…`
                          : node.name}
                      </text>
                    )}
                  </g>
                </Link>
              );
            })}
          </g>
        </svg>

        <div className="absolute right-3 top-3 flex gap-1.5">
          <ZoomButton label="Zoom in" onClick={() => zoomAt(middle, 1.4)}>
            +
          </ZoomButton>
          <ZoomButton label="Zoom out" onClick={() => zoomAt(middle, 1 / 1.4)}>
            −
          </ZoomButton>
          <ZoomButton
            label="Reset the view"
            onClick={() => applyView({ k: 1, x: 0, y: 0 })}
          >
            ⟲
          </ZoomButton>
        </div>

        <p className="mono pointer-events-none absolute bottom-3 left-3 hidden text-paper/45 sm:block">
          Drag to move · pinch or ⌘/Ctrl + scroll to zoom
        </p>
      </div>

      <figcaption className="mono mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-3">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink bg-surface"
          />
          Claimed
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-ink-3 bg-surface"
          />
          Unclaimed
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-px w-5 bg-accent" />
          Just connected
        </span>
        <span>Bigger node, more connections</span>
      </figcaption>
    </figure>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/5 font-mono text-sm text-paper/80 transition-colors hover:border-white/40 hover:text-paper"
    >
      {children}
    </button>
  );
}
