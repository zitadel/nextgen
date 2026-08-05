-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE encryption_keys
(
    project_id            STRING(MAX) NOT NULL,
    id                    STRING(MAX) NOT NULL,
    key                   STRING(MAX) NOT NULL,
    algorithm             STRING(MAX) NOT NULL,
    state                 STRING(MAX) NOT NULL,
    created_at            TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    activated_at          TIMESTAMP,
    retired_at            TIMESTAMP,
    purpose               STRING(MAX) NOT NULL,
    -- active_kek_project_id holds the project_id only while this row is the
    -- project's active key encryption key, and is NULL otherwise. Paired with the
    -- NULL_FILTERED unique index below it enforces "at most one active KEK per
    -- project" — Spanner's equivalent of the postgres partial unique index.
    active_kek_project_id STRING(MAX) AS (
        CASE WHEN state = 'active' AND purpose = 'kek' THEN project_id ELSE NULL END
    ) STORED,
    active_token_encryption_key_project_id STRING(MAX) AS (
        CASE WHEN state = 'active' AND purpose = 'token' THEN project_id ELSE NULL END
    ) STORED,
    active_secret_encryption_key_project_id STRING(MAX) AS (
        CASE WHEN state = 'active' AND purpose = 'secret' THEN project_id ELSE NULL END
    ) STORED,
    active_cookie_encryption_key_project_id STRING(MAX) AS (
        CASE WHEN state = 'active' AND purpose = 'cookie' THEN project_id ELSE NULL END
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
CREATE
UNIQUE
NULL_FILTERED INDEX idx_encryption_keys_active_kek
    ON encryption_keys (active_kek_project_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE
UNIQUE
NULL_FILTERED INDEX idx_encryption_keys_active_token_encryption_key
    ON encryption_keys (active_token_encryption_key_project_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE
UNIQUE
NULL_FILTERED INDEX idx_encryption_keys_active_secret_encryption_key
    ON encryption_keys (active_secret_encryption_key_project_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE
UNIQUE
NULL_FILTERED INDEX idx_encryption_keys_active_cookie_encryption_key
    ON encryption_keys (active_cookie_encryption_key_project_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE signing_keys
(
    project_id            STRING(MAX) NOT NULL,
    id                    STRING(MAX) NOT NULL,
    key                   STRING(MAX) NOT NULL,
    algorithm             STRING(MAX) NOT NULL,
    state                 STRING(MAX) NOT NULL,
    created_at            TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    activated_at          TIMESTAMP,
    retired_at            TIMESTAMP,
    purpose               STRING(MAX) NOT NULL,
    active_token_signing_key_project_id STRING(MAX) AS (
        CASE WHEN state = 'active' AND purpose = 'token' THEN project_id ELSE NULL END
    ) STORED,
    CONSTRAINT fk_signing_keys_project
        FOREIGN KEY (project_id)
            REFERENCES projects (id)
            ON DELETE CASCADE,
    CONSTRAINT chk_signing_keys_id CHECK (id <> ''),
    CONSTRAINT chk_signing_keys_key CHECK (key <> ''),
    CONSTRAINT chk_signing_keys_algorithm CHECK (algorithm <> ''),
    CONSTRAINT chk_signing_keys_state CHECK (state <> ''),
    CONSTRAINT chk_signing_keys_purpose CHECK (purpose <> ''),
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE
UNIQUE
NULL_FILTERED INDEX idx_signing_keys_active_token_signing_key
    ON signing_keys (active_token_signing_key_project_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_signing_keys_active_token_signing_key
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS signing_keys
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_kek
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_token_encryption_key
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_secret_encryption_key
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_cookie_encryption_key
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS encryption_keys
-- +goose StatementEnd
