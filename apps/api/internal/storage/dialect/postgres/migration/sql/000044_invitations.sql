-- +goose Up
-- An invitation is a link that grants its type's target to whoever redeems it
-- (ADR 086). expired is not stored: it is a pending row past expires_at.
-- Cancelling deletes the row, so there is no cancelled status.
CREATE TABLE zitadel_nextgen.invitations (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , type TEXT COLLATE "C" NOT NULL CHECK (type IN ('project_member'))
    -- The object named after the type: a document, so a type can grow fields
    -- without a migration on three dialects.
    , payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    -- The metadata JSON encrypted under the project's key, so TEXT with no
    -- JSON CHECK: the service validates the shape before encrypting. NULL
    -- once accepted or declined.
    , metadata TEXT
    , status TEXT COLLATE "C" NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected'))
    , created_by TEXT COLLATE "C"
    , created_by_type TEXT COLLATE "C"
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , expires_at TIMESTAMPTZ NOT NULL
    , journey_id TEXT COLLATE "C" NOT NULL CHECK (journey_id <> '')
    , accepted_by TEXT COLLATE "C"
    , accepted_at TIMESTAMPTZ
    -- Hex SHA-256 of the link's token; the plaintext is never stored.
    , token_hash TEXT COLLATE "C" NOT NULL CHECK (length(token_hash) = 64)

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT chk_invitations_accepted CHECK (
        (status = 'accepted') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
    )
);

-- Accept, decline and lookup carry only the token, so the hash is unique
-- across projects.
CREATE UNIQUE INDEX uq_invitations_token_hash
    ON zitadel_nextgen.invitations (token_hash);

-- Invitations list newest-first by keyset; id breaks created_at ties.
CREATE INDEX idx_invitations_project_created_at
    ON zitadel_nextgen.invitations (project_id, created_at DESC, id DESC);

-- Counts a project's pending invitations for the cap.
CREATE INDEX idx_invitations_project_status_expires_at
    ON zitadel_nextgen.invitations (project_id, status, expires_at);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_invitations_project_status_expires_at;
DROP INDEX IF EXISTS zitadel_nextgen.idx_invitations_project_created_at;
DROP INDEX IF EXISTS zitadel_nextgen.uq_invitations_token_hash;
DROP TABLE IF EXISTS zitadel_nextgen.invitations;
