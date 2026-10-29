-- +goose Up
-- Clients that registered themselves through dynamic client registration
-- (RFC 7591). A registration belongs to the project, not to an app: the app is
-- the one whose API a request names. It is transient data: POST /register is
-- unauthenticated, so a registration is purged once past expires_at unless a
-- live consent names it. id is minted and is the client_id. metadata holds
-- what the client registered with, as validated; secret_hash is set only for
-- a client the server gave a secret.
CREATE TABLE zitadel_nextgen.client_registrations (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
    , secret_hash TEXT COLLATE "C" CHECK (secret_hash <> '')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , expires_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, id)
);

-- Registrations list oldest-first by keyset; id breaks created_at ties.
CREATE INDEX idx_client_registrations_project_created_at
    ON zitadel_nextgen.client_registrations (project_id, created_at, id);

-- The purge reads a project's registrations past their expiry, oldest first.
CREATE INDEX idx_client_registrations_project_expires_at
    ON zitadel_nextgen.client_registrations (project_id, expires_at, id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_client_registrations_project_expires_at;
DROP INDEX IF EXISTS zitadel_nextgen.idx_client_registrations_project_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.client_registrations;
