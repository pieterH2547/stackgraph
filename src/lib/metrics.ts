import { getDb } from "./db/client";
import { countEvents, type EventName } from "./events";
import { REQUIRED_DOWNSTREAM, REQUIRED_UPSTREAM } from "./limits";

/**
 * This MVP exists to answer one question: does one vendor cause another vendor
 * to join? Nothing here is a vanity number, and profile count is deliberately
 * not a headline — a node with no edges is worth almost nothing.
 *
 *   K ≈ edges per claimed vendor
 *       × contactable rate
 *       × notification → claim conversion
 *       × claim → contribution completion
 *
 * K >= 1 means the network grows itself. And K only matters alongside cycle
 * time: K = 1.2 with a generation a day is a business, K = 1.2 with a
 * generation every two months is a hobby.
 */
export interface FlywheelMetrics {
  /* --- the four factors ------------------------------------------------- */
  /** Acquisition + proof edges created by claimed vendors, per claimed vendor. */
  edgesPerClaimedVendor: number;
  /** Of independent vendors identified by a mention, how many we can reach. */
  contactableRate: number;
  /** Of vendors we actually notified, how many verified a claim. */
  notificationToClaimRate: number;
  /** Of vendors that verified identity, how many finished the three edges. */
  claimToContributionRate: number;
  kFactor: number;
  selfSustaining: boolean;

  /* --- cycle time ------------------------------------------------------- */
  /** Median hours from the invitation going out to the claim completing. */
  medianCycleHours: number | null;
  fastestCycleHours: number | null;

  /* --- the funnel, in order -------------------------------------------- */
  funnel: {
    vendorsIdentified: number;
    contactable: number;
    notificationsDelivered: number;
    claimsClicked: number;
    claimsVerified: number;
    claimsCompleted: number;
    contributedNextEdges: number;
  };

  /* --- shape of the graph ---------------------------------------------- */
  edges: { acquisition: number; proof: number; stackOnly: number; total: number };
  claimedVendors: number;
  claimedVendorsWithStack: number;
  pendingClaims: number;
  generations: { generation: number; total: number; claimed: number }[];
  deepestClaimedGeneration: number;
  seedVendors: number;
  incumbentsInGraph: number;
  disputedEdges: number;
  events: Record<EventName, number>;
  requiredUpstream: number;
  requiredDownstream: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function getFlywheelMetrics(): Promise<FlywheelMetrics> {
  const db = getDb();

  const [
    claimedWithStack,
    claimedTotal,
    edgesFromClaimed,
    identified,
    notified,
    verified,
    edgeShape,
    generations,
    seeds,
    incumbents,
    disputed,
    cycles,
    clicks,
  ] = await Promise.all([
    // Claimed vendors that actually produced edges. Attribution is by who
    // reported the edge, not by its direction: a vendor naming a customer
    // creates an edge pointing at itself, and that is still its contribution.
    db.execute(`SELECT COUNT(DISTINCT c.id) AS n
                FROM companies c
                JOIN relationships r ON r.reported_by_company_id = c.id
                WHERE c.status = 'CLAIMED'`),
    db.execute(`SELECT COUNT(*) AS n FROM companies WHERE status = 'CLAIMED'`),
    // Edges that did something for the network: acquisition or proof.
    db.execute(`SELECT COUNT(*) AS n
                FROM relationships r
                JOIN companies reporter ON reporter.id = r.reported_by_company_id
                WHERE reporter.status = 'CLAIMED'
                  AND r.edge_kind IN ('ACQUISITION', 'PROOF')`),
    // Independent vendors that exist only because somebody named them.
    db.execute(`SELECT
                  COUNT(*) AS total,
                  SUM(CASE WHEN contact_email IS NOT NULL THEN 1 ELSE 0 END) AS contactable,
                  SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS claimed
                FROM companies
                WHERE source = 'MENTIONED' AND network_eligible = 1`),
    // Of the vendors we actually reached, how many went on to claim.
    db.execute(`SELECT
                  COUNT(DISTINCT c.id) AS notified,
                  COUNT(DISTINCT CASE WHEN c.claim_verified_at IS NOT NULL THEN c.id END) AS verified,
                  COUNT(DISTINCT CASE WHEN c.status = 'CLAIMED' THEN c.id END) AS claimed
                FROM companies c
                JOIN notifications n ON n.company_id = c.id AND n.status = 'SENT'`),
    // Identity verified vs claim finished: the both-sides drop-off.
    db.execute(`SELECT
                  COUNT(*) AS total,
                  SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS completed
                FROM companies WHERE claim_verified_at IS NOT NULL`),
    db.execute(`SELECT edge_kind AS kind, COUNT(*) AS n
                FROM relationships GROUP BY edge_kind`),
    db.execute(`SELECT generation,
                       COUNT(*) AS total,
                       SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS claimed
                FROM companies GROUP BY generation ORDER BY generation ASC`),
    db.execute(`SELECT COUNT(*) AS n FROM companies WHERE source = 'SEED'`),
    db.execute(`SELECT COUNT(*) AS n FROM companies WHERE network_eligible = 0`),
    db.execute(`SELECT COUNT(*) AS n FROM relationships WHERE state = 'DISPUTED'`),
    // Viral cycle time: first invitation out -> claim complete.
    db.execute(`SELECT c.claimed_at AS claimed_at, MIN(n.created_at) AS invited_at
                FROM companies c
                JOIN notifications n ON n.company_id = c.id AND n.status = 'SENT'
                WHERE c.status = 'CLAIMED' AND c.claimed_at IS NOT NULL
                GROUP BY c.id`),
    db.execute(`SELECT COUNT(DISTINCT company_id) AS n
                FROM events WHERE name = 'claim_clicked'`),
  ]);

  const claimedVendorsWithStack = Number(claimedWithStack.rows[0]?.n ?? 0);
  const vendorsIdentified = Number(identified.rows[0]?.total ?? 0);
  const contactable = Number(identified.rows[0]?.contactable ?? 0);

  const notificationsDelivered = Number(notified.rows[0]?.notified ?? 0);
  const notifiedThenVerified = Number(notified.rows[0]?.verified ?? 0);

  const claimsVerified = Number(verified.rows[0]?.total ?? 0);
  const claimsCompleted = Number(verified.rows[0]?.completed ?? 0);

  const edges = { acquisition: 0, proof: 0, stackOnly: 0, total: 0 };
  for (const row of edgeShape.rows) {
    const n = Number(row.n ?? 0);
    edges.total += n;
    if (row.kind === "ACQUISITION") edges.acquisition = n;
    else if (row.kind === "PROOF") edges.proof = n;
    else edges.stackOnly = n;
  }

  const edgesPerClaimedVendor = ratio(
    Number(edgesFromClaimed.rows[0]?.n ?? 0),
    claimedVendorsWithStack,
  );
  const contactableRate = ratio(contactable, vendorsIdentified);
  const notificationToClaimRate = ratio(
    notifiedThenVerified,
    notificationsDelivered,
  );
  const claimToContributionRate = ratio(claimsCompleted, claimsVerified);

  const kFactor =
    edgesPerClaimedVendor *
    contactableRate *
    notificationToClaimRate *
    claimToContributionRate;

  const cycleHours = cycles.rows
    .map((row) => {
      const invited = new Date(String(row.invited_at)).getTime();
      const claimed = new Date(String(row.claimed_at)).getTime();
      return (claimed - invited) / 3_600_000;
    })
    .filter((hours) => Number.isFinite(hours) && hours >= 0);

  const generationRows = generations.rows.map((row) => ({
    generation: Number(row.generation ?? 0),
    total: Number(row.total ?? 0),
    claimed: Number(row.claimed ?? 0),
  }));

  return {
    edgesPerClaimedVendor,
    contactableRate,
    notificationToClaimRate,
    claimToContributionRate,
    kFactor,
    selfSustaining: kFactor >= 1,

    medianCycleHours: median(cycleHours),
    fastestCycleHours: cycleHours.length ? Math.min(...cycleHours) : null,

    funnel: {
      vendorsIdentified,
      contactable,
      notificationsDelivered,
      claimsClicked: Number(clicks.rows[0]?.n ?? 0),
      claimsVerified,
      claimsCompleted,
      contributedNextEdges: claimedVendorsWithStack,
    },

    edges,
    claimedVendors: Number(claimedTotal.rows[0]?.n ?? 0),
    claimedVendorsWithStack,
    pendingClaims: Math.max(0, claimsVerified - claimsCompleted),
    generations: generationRows,
    deepestClaimedGeneration: generationRows
      .filter((row) => row.claimed > 0)
      .reduce((deepest, row) => Math.max(deepest, row.generation), 0),
    seedVendors: Number(seeds.rows[0]?.n ?? 0),
    incumbentsInGraph: Number(incumbents.rows[0]?.n ?? 0),
    disputedEdges: Number(disputed.rows[0]?.n ?? 0),
    events: await countEvents(),
    requiredUpstream: REQUIRED_UPSTREAM,
    requiredDownstream: REQUIRED_DOWNSTREAM,
  };
}
