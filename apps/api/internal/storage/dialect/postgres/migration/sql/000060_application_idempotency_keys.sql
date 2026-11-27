-- +goose Up
-- The Idempotency-Key of a POST /applications, kept for a window from the
-- first request. A retry with the same key and body replaces the secrets of
-- the clients the first request created. key_hash and request_hash are hex
-- SHA-256 from domain.HashSecret: no plaintext key or secret is stored.
-- client_ids holds the row ids of those clients, in document order. A create
-- replaces an expired record of the same key; nothing else deletes one yet.
CREATE TABLE zitadel_nextgen.application_idempotency_keys (
    project_id TEXT COLLATE "C" NOT NULL
    , key_hash TEXT COLLATE "C" NOT NULL CHECK (key_hash <> '')
    , request_hash TEXT COLLATE "C" NOT NULL
    , application_id TEXT COLLATE "C" NOT NULL
    , created BOOLEAN NOT NULL
    , client_ids TEXT[] NOT NULL
    , created_at TIMESTAMPTZ NOT NULL
    , expires_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, key_hash)
    , CONSTRAINT fk_application_idempotency_keys_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES zitadel_nextgen.applications (project_id, id)
        ON DELETE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.application_idempotency_keys;
