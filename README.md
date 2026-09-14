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
  → name 2 independent tools you genuinely use
  → 2 outgoing edges
  → those vendors automatically gain a "Used by" relationship
  → unclaimed target profiles become acquisition opportunities
  → contact route found from their own public site
  → "Someone actually uses your software."
  → target CLAIMS
  → target names 2 tools
  → …
```

If that is recursive, there is something here. If it isn't, no extra feature
saves it.

### One edge, both jobs

This is the whole design, and everything else follows from it:

> **The source company creates the relationship. The target company receives
> the proof.**

`Acme uses Tally` is stated once, by the only party entitled to state it, and
lands on two profiles at the same time:

| | |
| --- | --- |
| on **Acme** | Powered by → Tally |
| on **Tally** | Used by → Acme |

So a vendor never submits a customer list, and never needs to. Its `used by`
side is assembled entirely out of other companies' statements about their own
stacks — which is also what makes that side the strong one: everybody listed
there put the product in their own stack and said so in their own name.

### The claim gate

A profile turns `CLAIMED` when, and only when:

1. identity is settled (an emailed link, or the founder added the company), **and**
2. two **network-eligible** tools have been credited (`REQUIRED_UPSTREAM`).

That is the entire gate, and it lives in `src/lib/limits.ts`. Nobody named has
to confirm anything: a claim that depended on other people would stall the
whole network.

Naming your own customers used to be the other half of this. It was removed
rather than made optional — it was a vendor's word about somebody else, and
redundant with what the graph already derives, so it doubled the cost of a
claim to re-state something nobody needed told.

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

Every relationship is **self-reported**, and there is exactly one phrasing for
all of them:

> `Acme says it uses Tally`

There is no second phrasing to explain, because there is no second way to make
an edge. No confirmation is needed to make that sentence true — the product is
reporting who said what about their own stack, and attributing it — and
nothing anywhere claims a "verified customer".

The credited vendor gets one reply: *Not accurate*, which takes the edge out of
the public graph when it doesn't recognise the company at all. It never
touches anyone's claimed status; a claim others could revoke would make every
claim hostage to someone else.

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
npm test                 # 104 tests, no network, no mail provider
```

### Environment

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | `file:` path locally, libSQL/Turso URL in production. `TURSO_DATABASE_URL` is accepted too, because that is the name Turso's own Vercel integration injects. On Vercel with neither, it falls back to `/tmp`: the app runs, but each serverless instance gets its own copy, so two requests can disagree and nothing survives. |
| `DATABASE_AUTH_TOKEN` | Turso token, if the URL needs one. `TURSO_AUTH_TOKEN` is accepted as well. |
| `NEXT_PUBLIC_SITE_URL` | Used for share links, claim links and OG images. Falls back to the Vercel URL. |
| `RESEND_API_KEY` | With no key, every notification is written to the `notifications` table and printed to the log instead of being delivered, and claim links are shown on screen so the loop stays walkable locally. |
| `ADMIN_TOKEN` | Unlocks `/admin`. Unset means admin is unreachable. |
| `DISABLE_SITE_DETECTION=1` | Never read vendor websites (used by the test suite). |
| `NEXT_PUBLIC_BASE_PATH` | Serve the app under a path, e.g. `/test1`, when another site rewrites a subpath to it. Internal links, assets, API calls, share links, claim links and canonicals all pick it up. |
| `NEXT_PUBLIC_NOINDEX=1` | Every page goes `noindex, nofollow` and robots.txt disallows everything. Use it for any staging copy, and for a test mount on a domain that isn't ours. |

### Serving it under someone else's domain

To reach it at `example.com/test1` without merging the two apps, deploy this
app with `NEXT_PUBLIC_BASE_PATH=/test1` and add a rewrite on the host site
(Next's multi-zones pattern):

```ts
// host site's next.config.ts
async rewrites() {
  const zone = process.env.STACKGRAPH_ORIGIN; // https://<this app>.vercel.app
  if (!zone) return [];
  return [
    { source: "/test1", destination: `${zone}/test1` },
    { source: "/test1/:path*", destination: `${zone}/test1/:path*` },
  ];
}
```

`assetPrefix` follows `basePath`, so `/test1/_next/*` is covered by the second
rule. Two deployments, two databases, two sets of gates — a failure here can
only affect that one path on the host.

---

## The flow

| Route | What happens |
| --- | --- |
| `/` | Hero, the global graph, recently connected, the manifesto, growing networks |
| `/add` | One field: your website. Called *Claim your company*, because half the companies people look for already have a profile waiting — paste a domain that exists and you land on its claim page. |
| `/add/confirm` | "We found this" — name, one line, for whom, built by, category |
| `/stack/[slug]` | **The unlock page.** One task: *Add 2 tools you genuinely use*, with one-click suggestions read from your own site. Every tool you pick states its own consequence — "Tally gets: Used by Acme" — because that consequence is the product. |
| `/done/[slug]` | ✓ Claimed · ✓ See who uses you · ✓ Your network is live |
| `/c/[slug]` | The public profile: local graph, Used by, Powered by |
| `/claim/[slug]` | Curiosity first: *N companies say they use your product, M are on the network* |
| `/claim/[slug]/verify` | One button, then straight back into the flywheel |
| `/share/[slug]` | A shareable card that credits the *other* tools |
| `/network` | Everything, grouped by claimed / credited-not-claimed / incumbents |
| `/admin`, `/admin/metrics` | Seeding, per-company inspection, and the K-factor |

### Progressive unlock

An unclaimed profile shows *how many* companies name it and how many are
already on the network — never *who*. That is the reason to claim.

### About, and what it does

A profile carries up to 100 words about the company and two to four capability
bullets. Both are **extracted and attributed, never written by us** — the
whole claim of this product is that vendors own facts, so an LLM paragraph
about someone else's product would be the analyst essay it exists against.

Sources, in order: the description they wrote about themselves on purpose,
their own `/about` or `/features` page, and — only above its social proof — a
homepage. That last restriction is the important one. Assembling an About from
homepage copy read beautifully and was, about a third of the time, a customer
testimonial attributed to the company; a testimonial wall sits below the
pitch, so the cut removes it. Sentences also have to be complete, name the
company or speak as it, and not be a call to action, a price or a team bio.

A company with no about page and a homepage that opens on testimonials gets no
About, and that is the right answer.

### Prefilled contribution

`src/lib/signals.ts` reads the vendor's own public site and suggests the
third-party hosts its pages actually load from — a form embed, an analytics
script, a chat widget. It arrives as a question, never as a fact:

> We spotted these on acme.dev. Use any of them?

Nothing is added without a click. A correct stack is worth more than a long
one, so suggestions are a shortcut for the vendor and never a shortcut for us.

Incumbent rules are not explained up front. Add Stripe and it stays in your
stack, labelled where you can see it:

> Part of your stack · doesn't count toward the 2 independent tools

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

Only acquisition and proof edges count in the numerator: an incumbent sits in
the graph and stays out of the maths.

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
                           settleClaim, classifyEdge
    limits.ts              the claim price, in one place
    eligibility.ts         networkEligible — incumbent denylist
    detect.ts              read a public site for name/description/logo/contact
    signals.ts             one-click suggestions read from the vendor's site
    notify.ts              recognition emails, dedupe and cooldown
    metrics.ts             the four-factor K and cycle time
    graph.ts               deterministic graph geometry
  test/                    56 tests over the whole loop
scripts/                   db:push, db:seed, db:reset, db:inspect,
                           launchllama:score, launchllama:import
```

**Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind v4,
libSQL/SQLite, Vitest. No ORM, no state library, no component library, no
email SDK — one dependency beyond the framework.

### Data model

- **companies** — identity (name, one line, category, for whom, built by),
  `status`, `networkEligible`, `source`, `generation`, contact route, claim
  state, `updated_at`
- **relationships** — `source uses target`, plus `reported_by_company_id`
  (always the source, stored rather than assumed), `state` (self-reported /
  disputed) and `edge_kind`; unique per pair
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

## Generation 0

Cold start is a selection problem, not an import problem. `scripts/` holds a
three-step pipeline that throws most of a directory away:

```bash
npm run launchllama:fetch                                  # the real catalogue
npm run launchllama:score -- --in=data/launchllama.csv --enrich
npm run launchllama:import -- --limit=136                   # dry run, the default
npm run launchllama:import -- --write --local --limit=136
```

`launchllama:fetch` reads Launch Llama's own public catalogue API — the one
their `llms.txt` documents for agents, keyless for reads — and nothing else.
Reads only: never the endpoint that opens a listing draft, because an import is
not a submission. Their `robots.txt` disallows `/api/`, `/dashboard`, `/auth`,
`/admin`, `/notifications` and `/reset-password`; none of those are touched.
One request at a time, with a pause and a User-Agent that says who we are.

On the real 3,453-company catalogue: 262 excluded, 136 recommended at 4/6 or
better. Site reads are cached in `data/`, so changing the rubric and
re-scoring costs seconds rather than another quarter hour of somebody else's
bandwidth.

The score is 0–6, one point per criterion, and only positive evidence counts:
software product · small team · active · clear B2B use case · contactable ·
likely to run on other independent products. Anything it cannot establish
stays `unknown` rather than being guessed, which is why `--enrich` matters —
reading each site is what actually answers activity, contactability and stack
richness. Threshold is 4/6, and `data/launchllama-stackgraph-review.csv` is
meant to be opened and argued with before anything is written.

The score never reaches a page. It is import logic, not a rating.

Writing is deliberate by construction: dry run is the default, a local write
still needs `--local`, and a remote one needs `--remote` *and*
`--confirm-stackgraph-production` *and* a `DATABASE_URL` that really is
remote. An import creates `UNCLAIMED` profiles and nothing else — no
relationships, no claims, no email — and never overwrites a field on an
existing company with a directory's copy of it.

**Production imports run in `.github/workflows/gen0-import.yml` and nowhere
else.** The credentials live in the `production` GitHub Environment, where they
can be rotated and audited; a token pasted into a terminal, a chat or an agent
transcript cannot be revoked from there. The job always scores and always dry
runs, and writes only when dispatched with `confirm: yes`.

---

## Where it stands

The loop is implemented and tested end to end. What it has not had yet is the
only thing that matters: real vendors. Cold start needs 10–20 real independent
software companies seeded in `/admin`, each going through exactly the same
flow. Then hands off, and watch whether generation 2 appears without us
sourcing it.
