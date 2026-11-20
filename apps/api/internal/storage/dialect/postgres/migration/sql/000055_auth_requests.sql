-- +goose Up
-- An authorization request the endpoint validated, waiting for the login to
-- complete it (ADR 081 §8). Rows are never updated. code_challenge is empty
-- when the client sent none. client_id has no FK: a declared client
-- (#2790) lives in a release and has no row in application_clients.
-- deployment_id and release_id have no FK: they record what the request
-- resolved, and a revoked release is read, not cascaded.
CREATE TABLE zitadel_nextgen.auth_requests (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , client_id TEXT COLLATE "C" NOT NULL
    , redirect_uri TEXT NOT NULL
    , state TEXT NOT NULL
    , scopes TEXT[] NOT NULL
    , code_challenge TEXT COLLATE "C" NOT NULL
    , issuer TEXT NOT NULL
    , deployment_id TEXT COLLATE "C" NOT NULL
    , release_id TEXT COLLATE "C" NOT NULL
    , binding_hash TEXT COLLATE "C" NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , expires_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, id)
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.auth_requests;