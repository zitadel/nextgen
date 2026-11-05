-- The migrator's own state, beside nextgen's tables and never part of them.
-- `migrate-v4 cleanup` drops it: src rows hold v4 password hashes.
CREATE SCHEMA IF NOT EXISTS zitadel_migrate_v4;

-- A pending apply freezes aggregates until the exact plan has been recovered.
-- binding is a digest of source identity and immutable interpretation options.
CREATE TABLE IF NOT EXISTS zitadel_migrate_v4.bindings (
    instance_id TEXT PRIMARY KEY,
    binding TEXT NOT NULL,
    pending BOOLEAN NOT NULL DEFAULT false
);

-- How far ingest has read each instance: v4's event sort key.
CREATE TABLE IF NOT EXISTS zitadel_migrate_v4.cursors (
    instance_id TEXT PRIMARY KEY
    , position NUMERIC NOT NULL
    , in_tx_order BIGINT NOT NULL
    , aggregate_type TEXT NOT NULL
    , aggregate_id TEXT NOT NULL
    , sequence BIGINT NOT NULL
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reducers that folded the stage: another version re-reads v4 from the start.
ALTER TABLE zitadel_migrate_v4.cursors ADD COLUMN IF NOT EXISTS reducer_version INT NOT NULL DEFAULT 0;

-- One folded document per v4 aggregate, with the sequence of the newest event
-- folded into it.
CREATE TABLE IF NOT EXISTS zitadel_migrate_v4.aggregates (
    instance_id TEXT NOT NULL
    , aggregate_type TEXT NOT NULL
    , aggregate_id TEXT NOT NULL
    , sequence BIGINT NOT NULL
    , doc JSONB NOT NULL
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , PRIMARY KEY (instance_id, aggregate_type, aggregate_id)
);

-- Which nextgen resource each v4 source became. Managed IDs are reserved before
-- writes; configuration revisions are recovered by content before acknowledgement.
CREATE TABLE IF NOT EXISTS zitadel_migrate_v4.id_map (
    instance_id TEXT NOT NULL
    , source_kind TEXT NOT NULL
    , source_id TEXT NOT NULL
    , target_id TEXT NOT NULL
    , status TEXT NOT NULL CHECK (status IN ('reserved', 'applied'))
    , applied_sequence BIGINT NOT NULL DEFAULT 0
    , fingerprint TEXT NOT NULL DEFAULT ''
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , PRIMARY KEY (instance_id, source_kind, source_id)
);

-- One row per command run, with the report it printed.
CREATE TABLE IF NOT EXISTS zitadel_migrate_v4.runs (
    id BIGSERIAL PRIMARY KEY
    , instance_id TEXT NOT NULL
    , command TEXT NOT NULL
    , started_at TIMESTAMPTZ NOT NULL
    , finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , report JSONB NOT NULL
);
