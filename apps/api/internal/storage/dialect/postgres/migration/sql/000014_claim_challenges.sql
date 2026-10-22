-- +goose Up
CREATE TABLE zitadel_nextgen.claim_challenges (
    -- id is the SHA-256 hash of a handoff-token-style challenge token minted in
    -- Go (ADR 041 §3); the plaintext travels outside the system, only the hash
    -- is stored. Application-supplied, hence no DB default.
    id                     TEXT COLLATE "C" NOT NULL CHECK (id <> '') PRIMARY KEY
    , project_id             TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    -- SHA-256 of the project secret that initiated the claim; proves possession
    -- on claim/status (see Claim E1). COLLATE "C" keeps the equality-comparison
    -- on the byte-exact hash off the locale-dependent default collation.
    , initiating_secret_hash TEXT COLLATE "C" NOT NULL
    , status                 TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed'))
    , expires_at             TIMESTAMPTZ NOT NULL
    , created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves a future expiry sweep; automated expiry enforcement itself is out of
-- scope for this epic (ADR 041 §6).
CREATE INDEX idx_claim_challenges_expires_at
    ON zitadel_nextgen.claim_challenges (expires_at);

-- Postgres does not auto-index FK columns. This covers the projects ON DELETE
-- CASCADE (otherwise a sequential scan of claim_challenges per deleted project)
-- and future "challenges for this project" lookups. Spanner auto-creates a
-- backing index for the FK, so this is Postgres-only.
CREATE INDEX idx_claim_challenges_project_id
    ON zitadel_nextgen.claim_challenges (project_id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_claim_challenges_project_id;
DROP INDEX IF EXISTS zitadel_nextgen.idx_claim_challenges_expires_at;
DROP TABLE IF EXISTS zitadel_nextgen.claim_challenges;
