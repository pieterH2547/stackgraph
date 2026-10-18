import { getDb } from "./db/client";
import { countEvents, type EventName } from "./events";
import { REQUIRED_UPSTREAM } from "./limits";

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
  /** Generation 0 we put there ourselves: seeded, imported or via admin. */
  seedVendors: number;
  incumbentsInGraph: number;
  disputedEdges: number;
  events: Record<EventName, number>;
  requiredUpstream: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/* -------------------------------------------------------------------------- */
/* the acquisition funnel                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Five numbers, in the order a company moves through them.
 *
 * Read from `companies` and `relationships` rather than from the event log,
 * on purpose. Events are append-only and can be missed — a deploy mid-flow, a
 * failed write — while the rows are the thing itself: a company either has a
 * membership or it does not. The event counts stay on this page underneath,
 * and a gap between the two is itself worth seeing.
 *
 * The last number is the only one that matters in the end. Everything above
 * it can be bought with traffic; `followOnClaims` cannot, because it counts
 * companies that were put on the graph by somebody else's credit and then
 * came back and claimed. That is the flywheel turning a second time.
 */
export interface AcquisitionFunnel {
  /** Added their own company through /add. */
  selfAdded: number;
  /** Of those, identity established — the ownership flow completed. */
  verifiedClaims: number;
  /** Credits those companies gave: edges they reported about their own stack. */
  outgoingCredits: number;
  /** Profiles that exist only because a credit named them. */
  mentionedProfiles: number;
  /** Of those, the ones that have since claimed. The recursion. */
  followOnClaims: number;
  /** How those follow-on claims got here. Sums to `followOnClaims`. */
  attribution: FollowOnAttribution;
}

/**
 * Why a credited profile came back — and whether we may take credit for it.
 *
 * A claim by a MENTIONED profile is the number the whole MVP is built to
 * produce, which is exactly why it must not be read too generously. Two very
 * different things look identical in the `companies` table: a founder who got
 * our recognition email and followed the link, and a founder who heard about
 * the site elsewhere, searched for their company and claimed the profile that
 * happened to be waiting. The first is the flywheel. The second is demand we
 * did not create, and counting it as flywheel would mean reporting a working
 * loop that is not running.
 *
 * Three buckets, strongest evidence first, each company counted once:
 *
 *  - `clicked`  — a `claim_clicked` event for this company before it claimed.
 *                 They came through our link; nothing else explains that URL.
 *  - `invited`  — no click recorded, but a recognition email really left the
 *                 building before they claimed (`claim_email_sent` with the
 *                 `resend` transport). Weaker: they were reached, and may
 *                 have typed the address rather than clicking.
 *  - `organic`  — neither. Something brought them here and it was not us, or
 *                 it was us by a route we do not measure.
 *
 * The `resend` test matters more than it looks. With `RESEND_API_KEY` unset —
 * which is the deliberate production setting — every notification is still
 * written with `status = 'SENT'`, over the `outbox` transport, meaning it was
 * recorded and never delivered. Treating those as invitations would credit
 * the loop with mail nobody received.
 */
export interface FollowOnAttribution {
  clicked: number;
  invited: number;
  organic: number;
}

export async function getAcquisitionFunnel(): Promise<AcquisitionFunnel> {
  const db = getDb();

  const [joined, credits, mentioned] = await Promise.all([
    db.execute(
      `SELECT
         COUNT(*) AS self_added,
         SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS verified
       FROM companies
       WHERE source = 'SELF_ADDED'`,
    ),
    // Attributed to whoever stated it, which is always the company talking
    // about its own stack. A disputed edge is not a credit any more.
    db.execute(
      `SELECT COUNT(*) AS n
         FROM relationships r
         JOIN companies c ON c.id = r.reported_by_company_id
        WHERE c.source = 'SELF_ADDED' AND r.state != 'DISPUTED'`,
    ),
    db.execute(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS claimed
       FROM companies
       WHERE source = 'MENTIONED'`,
    ),
  ]);

  return {
    selfAdded: Number(joined.rows[0]?.self_added ?? 0),
    verifiedClaims: Number(joined.rows[0]?.verified ?? 0),
    outgoingCredits: Number(credits.rows[0]?.n ?? 0),
    mentionedProfiles: Number(mentioned.rows[0]?.total ?? 0),
    followOnClaims: Number(mentioned.rows[0]?.claimed ?? 0),
    attribution: await attributeFollowOnClaims(),
  };
}

/**
 * Classified in TypeScript rather than in SQL because the deciding fact —
 * which transport carried the invitation — lives inside a JSON column, and a
 * `LIKE '%resend%'` over somebody's props is not a measurement anyone should
 * have to trust. The set being classified is the rarest thing in the
 * database, so reading it row by row costs nothing.
 */
async function attributeFollowOnClaims(): Promise<FollowOnAttribution> {
  const db = getDb();

  const { rows: claimants } = await db.execute(
    `SELECT id, claimed_at
       FROM companies
      WHERE source = 'MENTIONED' AND status = 'CLAIMED'`,
  );

  const attribution: FollowOnAttribution = {
    clicked: 0,
    invited: 0,
    organic: 0,
  };
  if (claimants.length === 0) return attribution;

  const { rows: events } = await db.execute(
    `SELECT company_id, name, props, created_at
       FROM events
      WHERE name IN ('claim_clicked', 'claim_email_sent')`,
  );

  const clicks = new Map<string, string[]>();
  const delivered = new Map<string, string[]>();

  for (const row of events) {
    const companyId = String(row.company_id ?? "");
    if (!companyId) continue;
    const at = String(row.created_at);

    if (String(row.name) === "claim_clicked") {
      clicks.set(companyId, [...(clicks.get(companyId) ?? []), at]);
      continue;
    }

    // Only mail that actually left counts as having reached anyone.
    let transport: unknown;
    try {
      transport = JSON.parse(String(row.props ?? "{}"))?.transport;
    } catch {
      transport = undefined;
    }
    if (transport === "resend") {
      delivered.set(companyId, [...(delivered.get(companyId) ?? []), at]);
    }
  }

  for (const row of claimants) {
    const id = String(row.id);
    // A claim with no timestamp cannot be ordered against anything, so the
    // only honest reading is that we do not know what brought them.
    const claimedAt = row.claimed_at ? String(row.claimed_at) : null;
    const before = (at: string) => claimedAt === null || at <= claimedAt;

    if ((clicks.get(id) ?? []).some(before)) attribution.clicked++;
    else if ((delivered.get(id) ?? []).some(before)) attribution.invited++;
    else attribution.organic++;
  }

  return attribution;
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
    // Cohort we put there ourselves, whether hand-seeded or imported. It is
    // the baseline the recursion has to beat, so an import must not quietly
    // count as growth.
    db.execute(
      `SELECT COUNT(*) AS n FROM companies WHERE source IN ('SEED', 'LAUNCHLLAMA', 'ADMIN')`,
    ),
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
  };
}
