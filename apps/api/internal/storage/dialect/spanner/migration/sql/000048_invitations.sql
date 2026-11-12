-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- An invitation is a link that grants its type's target to whoever redeems it
-- (ADR 086). See the postgres migration for the columns.
CREATE TABLE invitations (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    type            STRING(MAX) NOT NULL,
    payload         JSON        NOT NULL,
    metadata        STRING(MAX),
    status          STRING(MAX) NOT NULL DEFAULT ('pending'),
    created_by      STRING(MAX),
    created_by_type STRING(MAX),
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    expires_at      TIMESTAMP   NOT NULL,
    journey_id      STRING(MAX) NOT NULL,
    accepted_by     STRING(MAX),
    accepted_at     TIMESTAMP,
    token_hash      STRING(64)  NOT NULL,
    CONSTRAINT chk_invitations_id CHECK (id <> ''),
    CONSTRAINT chk_invitations_type CHECK (type = 'project_member'),
    CONSTRAINT chk_invitations_payload CHECK (JSON_TYPE(payload) = 'object'),
    CONSTRAINT chk_invitations_status CHECK (
        status = 'pending' OR status = 'accepted' OR status = 'rejected'
    ),
    CONSTRAINT chk_invitations_journey_id CHECK (journey_id <> ''),
    CONSTRAINT chk_invitations_token_hash CHECK (CHAR_LENGTH(token_hash) = 64),
    CONSTRAINT chk_invitations_accepted CHECK (
        (status = 'accepted') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
    ),
    CONSTRAINT fk_invitations_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_invitations_token_hash
    ON invitations (token_hash)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_invitations_project_created_at
    ON invitations (project_id, created_at DESC, id DESC)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_invitations_project_status_expires_at
    ON invitations (project_id, status, expires_at)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_invitations_project_status_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_invitations_project_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_invitations_token_hash
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS invitations
-- +goose StatementEnd
