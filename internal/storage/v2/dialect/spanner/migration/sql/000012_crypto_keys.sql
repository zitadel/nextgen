-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE encryption_keys (
    project_id   STRING(MAX) NOT NULL,
    id           STRING(MAX) NOT NULL,
    key          STRING(MAX) NOT NULL,
    algorithm    STRING(MAX) NOT NULL,
    state        STRING(MAX) NOT NULL,
    created_at   TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    activated_at TIMESTAMP,
    retired_at   TIMESTAMP,
    purpose      STRING(MAX) NOT NULL,
    -- active_dek_project_id holds the project_id only while this row is the
    -- project's active DEK, and is NULL otherwise. Paired with the
    -- NULL_FILTERED unique index below it enforces "at most one active DEK per
    -- project" — Spanner's equivalent of the postgres partial unique index.
    active_dek_project_id STRING(MAX) AS (
        CASE WHEN state = 'active' AND purpose = 'dek' THEN project_id ELSE NULL END
    ) STORED,
    CONSTRAINT fk_encryption_keys_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT chk_encryption_keys_id CHECK (id <> ''),
    CONSTRAINT chk_encryption_keys_key CHECK (key <> ''),
    CONSTRAINT chk_encryption_keys_algorithm CHECK (algorithm <> ''),
    CONSTRAINT chk_encryption_keys_state CHECK (state <> ''),
    CONSTRAINT chk_encryption_keys_purpose CHECK (purpose <> ''),
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_encryption_keys_active_dek
    ON encryption_keys (active_dek_project_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_dek
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS encryption_keys
-- +goose StatementEnd
