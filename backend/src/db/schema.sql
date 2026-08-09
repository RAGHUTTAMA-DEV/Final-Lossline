-- LOSSLine Phase 0 schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_store_occurred
  ON events (store_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_ingested
  ON events (id);

CREATE TABLE IF NOT EXISTS incidents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      TEXT NOT NULL,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL,
  baseline      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT incidents_status_check CHECK (
    status IN (
      'DETECTED',
      'INVESTIGATING',
      'AWAITING_APPROVAL',
      'APPROVED',
      'EXECUTING',
      'VERIFYING',
      'RESOLVED',
      'NOT_IMPROVED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_incidents_store_status
  ON incidents (store_id, status);

CREATE TABLE IF NOT EXISTS agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  step          INTEGER NOT NULL,
  messages      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_incident_step
  ON agent_runs (incident_id, step);

CREATE TABLE IF NOT EXISTS recommendations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  confidence          INTEGER NOT NULL,
  explanation         TEXT NOT NULL,
  action_type         TEXT NOT NULL,
  estimated_exposure  NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_incident
  ON recommendations (incident_id);

CREATE TABLE IF NOT EXISTS actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  recommendation_id   UUID NOT NULL REFERENCES recommendations (id) ON DELETE CASCADE,
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  executed_at         TIMESTAMPTZ,
  params              JSONB
);

CREATE INDEX IF NOT EXISTS idx_actions_incident
  ON actions (incident_id);

CREATE TABLE IF NOT EXISTS outcomes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  before        JSONB NOT NULL,
  after         JSONB NOT NULL,
  verdict       TEXT NOT NULL,
  evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outcomes_verdict_check CHECK (
    verdict IN ('RESOLVED', 'NOT_IMPROVED')
  )
);

CREATE INDEX IF NOT EXISTS idx_outcomes_incident
  ON outcomes (incident_id);

CREATE TABLE IF NOT EXISTS rolling_metrics (
  store_id        TEXT NOT NULL,
  metric          TEXT NOT NULL,
  window_minutes  INTEGER NOT NULL,
  value           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, metric, window_minutes)
);
