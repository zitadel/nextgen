-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE claim_challenges (
    -- id is the SHA-256 hash of a handoff-token-style challenge token minted in
    -- Go (ADR 041 §3); the plaintext travels outside the system, only the hash
    -- is stored. Application-supplied, hence no DB default.
    id                     STRING(MAX) NOT NULL,
    project_id             STRING(MAX) NOT NULL,
    -- SHA-256 of the project secret that initiated the claim; proves possession
    -- on claim/status (see Claim E1).
    initiating_secret_hash STRING(MAX) NOT NULL,
    status                 STRING(MAX) NOT NULL DEFAULT ('pending'),
    expires_at             TIMESTAMP   NOT NULL,
    created_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_claim_challenges_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT chk_claim_challenges_id CHECK (id <> ''),
    CONSTRAINT chk_claim_challenges_status CHECK (
        status = 'pending' OR status = 'completed'
    ),
) PRIMARY KEY (id)
-- +goose StatementEnd
-- +goose StatementBegin
-- Serves a future expiry sweep; automated expiry enforcement itself is out of
-- scope for this epic (ADR 041 §6).
CREATE INDEX idx_claim_challenges_expires_at
    ON claim_challenges (expires_at)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_claim_challenges_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS claim_challenges
-- +goose StatementEnd
