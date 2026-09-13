# Stackgraph

**Find out who uses your software.**

The independent software graph. Every company shows two things:

- **Powered by** — which independent tools it uses
- **Used by** — which software companies use it

Not a directory. Not a launch site. Not a marketplace. The relationships are
the product; the profiles are almost incidental.

"Independent software" is the *category*, never the brand: naming a product
after smallness tells people they're smaller than they think they are.
"Small software powers small software" is a manifesto line, and it lives in
the manifesto — the hero has to be a reason to claim, not a belief.

---

## The one thing this MVP tests

> Does one claimed vendor reliably cause other vendors to claim, without us
> sourcing each one by hand?

Everything in the repository exists to serve, or to measure, this loop:

```
CLAIM
  → 2 independent tools that power you   (upstream edges)
  → 2 software companies you power       (downstream edges)
  → 4 edges, unclaimed profiles created automatically
  → contact route found from their own public site
  → "Someone actually uses your software."
  → CLAIM
  → 4 more edges
  → …
```

If that is recursive, there is something here. If it isn't, no extra feature
saves it.

### The claim gate

A profile turns `CLAIMED` when, and only when:

1. identity is settled (an emailed link, or the founder added the company), **and**
2. two **independent** tools have been credited (`REQUIRED_UPSTREAM`), **and**
3. two software companies have been named as users (`REQUIRED_DOWNSTREAM`).

Nobody named has to confirm anything. A claim that depended on other people
would stall the whole network. Both constants live in `src/lib/limits.ts`.

Large incumbents (Stripe, Vercel, OpenAI, Slack…) may sit in a stack but never
count towards the two and never trigger the loop:

> Big tools may appear in the graph. Small tools are the graph.

### One kind of edge

`source uses target`, and nothing else. A recommendation is a different claim
— an endorsement of somebody else's product — and this graph never makes one
on anyone's behalf. No stars, no ratings, no rankings, no "top" anything.

### Every edge does one of two jobs

| `edge_kind`   | When                                   | What it buys |
| ------------- | -------------------------------------- | ------------ |
| `ACQUISITION` | target is independent and unclaimed    | a possible next vendor |
| `PROOF`       | target is independent and already claimed | their `used by` count goes up |
| `STACK_ONLY`  | target is an incumbent                 | visible stack data, nothing else |

So overlap is never wasted, and hubs don't break the flywheel.

### Trust

Every relationship is **self-reported** and labelled as such:

- `Acme says it uses Tally` — Acme's word
- `Tally says Acme uses its product` — Tally's word, until Acme confirms it

The named company can answer *Looks right* or *Not accurate*. A disputed edge
leaves the public graph; the vendor who stated it keeps its claimed status.
Nothing anywhere claims a "verified customer". No stars, no ratings, no
rankings.

---

## Running it

```bash
npm install
cp .env.example .env     # defaults work as-is for local development
npm run db:push          # create the SQLite schema
npm run dev              # http://localhost:3000
```

Optional, for looking at a populated graph:

```bash
npm run db:seed          # invented DEMO relationships, every row is_demo = 1
npm run db:inspect       # dump the local graph
npm run db:reset         # empty every table
```

Every script reads `.env` first (`scripts/load-env.ts`). Without that, a
`DATABASE_URL` pointing at Turso would be ignored and `db:push` would quietly
build a schema in a local file instead.

### Gates

```bash
npm run verify           # typecheck + lint + tests + production build
npm test                 # 48 tests, no network, no mail provider
```

### Environment

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | `file:` path locally, libSQL/Turso URL in production. On Vercel without one, it falls back to `/tmp` — the app runs but data lives only as long as that instance. |
| `DATABASE_AUTH_TOKEN` | Turso token, if the URL needs one. |
| `NEXT_PUBLIC_SITE_URL` | Used for share links, claim links and OG images. Falls back to the Vercel URL. |
| `RESEND_API_KEY` | With no key, every notification is written to the `notifications` table and printed to the log instead of being delivered, and claim links are shown on screen so the loop stays walkable locally. |
| `ADMIN_TOKEN` | Unlocks `/admin`. Unset means admin is unreachable. |
| `DISABLE_SITE_DETECTION=1` | Never read vendor websites (used by the test suite). |

---

## The flow

| Route | What happens |
| --- | --- |
| `/` | Hero, the global graph, recently connected, the manifesto, growing networks |
| `/add` | One field: your website. Called *Claim your company*, because half the companies people look for already have a profile waiting — paste a domain that exists and you land on its claim page. |
| `/add/confirm` | "We found this" — name, one line, for whom, built by, category |
| `/stack/[slug]` | **The unlock page.** Both halves, with one-click suggestions read from your own site |
| `/done/[slug]` | ✓ Profile claimed · ✓ See who uses you · ✓ Your network is live |
| `/c/[slug]` | The public profile: local graph, Used by, Powered by |
| `/claim/[slug]` | Curiosity first: *N companies say they use your product, M are on the network* |
| `/claim/[slug]/verify` | One button, then straight back into the flywheel |
| `/share/[slug]` | A shareable card that credits the *other* tools |
| `/network` | Everything, grouped by claimed / credited-not-claimed / incumbents |
| `/admin`, `/admin/metrics` | Seeding, per-company inspection, and the K-factor |

### Progressive unlock

An unclaimed profile shows *how many* companies name it and how many are
already on the network — never *who*. That is the reason to claim, and it
means we never publish someone else's customer list on their behalf.

### Prefilled contribution

`src/lib/signals.ts` reads the vendor's own public site to suggest both halves:

- **Powered by** — third-party hosts the page actually loads from (a form
  embed, an analytics script, a chat widget). Strong signal: the tool is
  literally running on their site.
- **Used by** — companies linked inside a "trusted by" or testimonial block.
  Weaker, which is why it arrives as a question, never as a fact.

The goal is `confirm → confirm → done` rather than typing four things, because
cycle time is a headline metric.

---

## Metrics

`/admin/metrics` computes the effective K-factor as four factors, not one:

```
K = edges per claimed vendor
  × contactable rate
  × notification → claim conversion
  × claim → contribution completion
```

`3.5 × 0.8 × 0.5 × 0.8 ≈ 1.12` grows. `3 × 0.6 × 0.25 × 0.7 ≈ 0.32` dies.

**Contactability is a first-class metric**: an unclaimed vendor with no
contact route stays in the graph but is not an acquisition opportunity, and
the page says so. Viral cycle time (invitation sent → claim completed) sits
next to K, because K without cycle time says nothing.

Profile count is deliberately not a headline. A node without edges is worth
almost nothing.

The public surfaces follow the same rule: the homepage shows **recently
connected** and **growing networks** (last 7 days, with the change, not the
total). A "most used" table is a popularity contest with extra steps, and the
same handful of names would sit on top of it forever.

---

## Architecture

```
src/
  app/                     routes (App Router, every data page dynamic)
  actions/                 server actions: company, stack, claim, admin
  components/              UI, incl. StackEditor, LocalGraph, GlobalGraph
  lib/
    db/schema.ts           the whole data model, 5 tables
    db/client.ts           one libSQL client, lazy schema
    db/queries.ts          typed SQL, no ORM
    network.ts             the flywheel: addCompany, submitStack,
                           submitCustomers, settleClaim, classifyEdge
    limits.ts              the claim price, in one place
    eligibility.ts         networkEligible — incumbent denylist
    detect.ts              read a public site for name/description/logo/contact
    signals.ts             suggestions for both halves of a claim
    notify.ts              recognition emails, dedupe and cooldown
    metrics.ts             the four-factor K and cycle time
    graph.ts               deterministic graph geometry
  test/                    48 tests over the whole loop
scripts/                   db:push, db:seed, db:reset, db:inspect
```

**Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind v4,
libSQL/SQLite, Vitest. No ORM, no state library, no component library, no
email SDK — one dependency beyond the framework.

### Data model

- **companies** — identity (name, one line, category, for whom, built by),
  `status`, `networkEligible`, `source`, `generation`, contact route, claim
  state, `updated_at`
- **relationships** — `source uses target`, plus `reported_by_company_id`,
  `state` (self-reported / confirmed / disputed) and `edge_kind`; unique per
  pair
- **claims** — one row per claim attempt, with domain-match flag
- **notifications** — every invitation, sent or queued, with the mention count
  at the time
- **events** — the funnel, and nothing else

---

## Deliberately not built

No payments, subscriptions, sponsorships or monetisation. No marketplace,
launch rankings, reviews, star ratings, voting, upvotes or comments. No buyer
intent, procurement, deals, vendor intelligence or competitive analytics. No
chat, DMs, jobs, community feed, affiliate links, mobile app, browser
extension, integration marketplace or SEO content engine. No vendor dashboard.

Monetisation is a question for after generation 2, 3 and 4 demonstrably exist
on their own.

---

## Where it stands

The loop is implemented and tested end to end. What it has not had yet is the
only thing that matters: real vendors. Cold start needs 10–20 real independent
software companies seeded in `/admin`, each going through exactly the same
flow. Then hands off, and watch whether generation 2 appears without us
sourcing it.
