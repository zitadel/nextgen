-- +goose Up
-- +goose StatementBegin
-- An invitation is a link that grants its type's target to whoever redeems it
-- (ADR 086). See the postgres migration for the columns. Timestamps are unix
-- nanos stamped in Go, as everywhere else in this dialect.
CREATE TABLE invitations (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    type            TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    metadata        TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending',
    created_by      TEXT,
    created_by_type TEXT,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    journey_id      TEXT    NOT NULL,
    accepted_by     TEXT,
    accepted_at     INTEGER,
    token_hash      TEXT    NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_invitations_id CHECK (id <> ''),
    CONSTRAINT chk_invitations_type CHECK (type IN ('project_member')),
    CONSTRAINT chk_invitations_payload CHECK (json_type(payload) = 'object'),
    CONSTRAINT chk_invitations_status CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT chk_invitations_journey_id CHECK (journey_id <> ''),
    CONSTRAINT chk_invitations_token_hash CHECK (length(token_hash) = 64),
    CONSTRAINT chk_invitations_accepted CHECK (
        (status = 'accepted') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
    ),
    CONSTRAINT fk_invitations_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_invitations_token_hash
    ON invitations (token_hash);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_invitations_project_created_at
    ON invitations (project_id, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_invitations_project_status_expires_at
    ON invitations (project_id, status, expires_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_invitations_project_status_expires_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_invitations_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_invitations_token_hash;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS invitations;
-- +goose StatementEnd
