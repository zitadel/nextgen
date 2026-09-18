-- +goose Up
-- Environments split into two classes: the one live environment every
-- project has, and preview environments created on demand that share the
-- project's data, resolve by request origin and expire on their own.
ALTER TABLE zitadel_nextgen.environments
    ADD COLUMN class TEXT COLLATE "C" NOT NULL DEFAULT 'live'
        CHECK (class IN ('live', 'preview'));

-- NULL on live: it never expires.
ALTER TABLE zitadel_nextgen.environments
    ADD COLUMN expires_at TIMESTAMPTZ;

-- JSON array of lowercased origins that resolve to this environment. NULL on
-- live: a request matching no preview origin is served by live.
ALTER TABLE zitadel_nextgen.environments
    ADD COLUMN origins JSONB
        CHECK (origins IS NULL OR jsonb_typeof(origins) = 'array');

-- +goose Down
ALTER TABLE zitadel_nextgen.environments DROP COLUMN IF EXISTS origins;
ALTER TABLE zitadel_nextgen.environments DROP COLUMN IF EXISTS expires_at;
ALTER TABLE zitadel_nextgen.environments DROP COLUMN IF EXISTS class;
