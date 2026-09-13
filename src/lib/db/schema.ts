/**
 * The whole data model. Five tables: companies, the relationships between
 * them, claims, the notifications those relationships trigger, and an event
 * log that exists purely so the flywheel can be measured.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  domain             TEXT NOT NULL UNIQUE,
  website            TEXT NOT NULL,
  logo_url           TEXT,
  -- One sentence, written by the vendor. We don't write anyone's story: no
  -- features, no pricing research, no pros and cons, no verdicts.
  description        TEXT,
  category           TEXT,
  -- "For whom?" — e.g. small SaaS teams, agencies, sales teams.
  audience           TEXT,
  -- Optional founder or team name.
  built_by           TEXT,
  status             TEXT NOT NULL DEFAULT 'UNCLAIMED',
  network_eligible   INTEGER NOT NULL DEFAULT 1,
  eligibility_reason TEXT NOT NULL DEFAULT 'ASSUMED_INDEPENDENT',
  source             TEXT NOT NULL DEFAULT 'MENTIONED',
  generation         INTEGER NOT NULL DEFAULT 0,
  detected_at        TEXT,
  detected_from      TEXT,
  contact_email      TEXT,
  claim_name         TEXT,
  claim_role         TEXT,
  -- Identity established (email verified, or added by its own founder). The
  -- claim only completes once both sides of the company have been shown.
  claim_verified_at  TEXT,
  claimed_at         TEXT,
  edit_token         TEXT NOT NULL,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  -- When the profile or its relationships last changed. Shown publicly, so a
  -- reader can see how current the graph around this company is.
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS companies_status_idx  ON companies (status);
CREATE INDEX IF NOT EXISTS companies_created_idx ON companies (created_at);
CREATE INDEX IF NOT EXISTS companies_source_idx  ON companies (source);

-- "source uses target", always attributed to whoever said it. A relationship
-- is self-reported until the other end confirms it, and nothing here ever
-- claims a verified customer.
CREATE TABLE IF NOT EXISTS relationships (
  id                     TEXT PRIMARY KEY,
  source_company_id      TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  target_company_id      TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  -- There is one kind of edge: "source uses target". A recommendation is a
  -- different claim entirely — an endorsement — and this graph doesn't make
  -- endorsements on anyone's behalf.
  -- The company that stated it: normally the source, or the target when a
  -- vendor names its own customers.
  reported_by_company_id TEXT REFERENCES companies (id) ON DELETE SET NULL,
  state                  TEXT NOT NULL DEFAULT 'SELF_REPORTED',
  -- ACQUISITION when it created or targets an unclaimed independent vendor,
  -- PROOF when the vendor is already claimed, STACK_ONLY for incumbents.
  edge_kind              TEXT NOT NULL DEFAULT 'ACQUISITION',
  created_at             TEXT NOT NULL,
  UNIQUE (source_company_id, target_company_id)
);

CREATE INDEX IF NOT EXISTS relationships_source_idx  ON relationships (source_company_id);
CREATE INDEX IF NOT EXISTS relationships_target_idx  ON relationships (target_company_id);
CREATE INDEX IF NOT EXISTS relationships_created_idx ON relationships (created_at);

CREATE TABLE IF NOT EXISTS claims (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  domain_match INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS claims_company_idx ON claims (company_id);

CREATE TABLE IF NOT EXISTS notifications (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,
  to_email              TEXT,
  subject               TEXT NOT NULL,
  body                  TEXT NOT NULL,
  mention_count_at_send INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_company_idx ON notifications (company_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  company_id        TEXT,
  target_company_id TEXT,
  props             TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_name_idx    ON events (name);
CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at);
`;

export const TABLES = [
  "events",
  "notifications",
  "claims",
  "relationships",
  "companies",
] as const;
