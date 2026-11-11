-- +goose NO TRANSACTION
-- +goose Up
-- Dedicated credential tables (Postgres: 000004_users.sql). Spanner's 000004 only
-- created the EAV user tables; these statements fill that gap.

-- +goose StatementBegin
CREATE TABLE user_passwords (
    project_id             STRING(MAX) NOT NULL,
    id                     STRING(MAX) NOT NULL,
    user_id                STRING(MAX) NOT NULL,
    encoded_hash           STRING(MAX) NOT NULL,
    change_required        BOOL        NOT NULL DEFAULT (FALSE),
    changed_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    verification_id        STRING(MAX),
    last_successful_check  TIMESTAMP,
    failed_attempts        INT64       NOT NULL DEFAULT (0),
    created_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_user_passwords_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_user_passwords_encoded_hash CHECK (encoded_hash <> ''),
    CONSTRAINT chk_user_passwords_failed_attempts CHECK (failed_attempts >= 0),
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_passwords_user
    ON user_passwords (project_id, user_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_totp (
    project_id             STRING(MAX) NOT NULL,
    id                     STRING(MAX) NOT NULL,
    user_id                STRING(MAX) NOT NULL,
    secret                 BYTES(MAX)  NOT NULL,
    verified_at            TIMESTAMP,
    last_successful_check  TIMESTAMP,
    failed_attempts        INT64       NOT NULL DEFAULT (0),
    created_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_user_totp_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_user_totp_failed_attempts CHECK (failed_attempts >= 0),
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_totp_user
    ON user_totp (project_id, user_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_recovery_codes (
    project_id             STRING(MAX) NOT NULL,
    id                     STRING(MAX) NOT NULL,
    user_id                STRING(MAX) NOT NULL,
    recovery_codes         ARRAY<STRING(MAX)> NOT NULL,
    last_successful_check  TIMESTAMP,
    failed_attempts        INT64       NOT NULL DEFAULT (0),
    created_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_user_recovery_codes_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_user_recovery_codes_nonempty CHECK (ARRAY_LENGTH(recovery_codes) > 0),
    CONSTRAINT chk_user_recovery_codes_failed_attempts CHECK (failed_attempts >= 0),
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_recovery_codes_user
    ON user_recovery_codes (project_id, user_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_passkeys (
    project_id        STRING(MAX) NOT NULL,
    id                STRING(MAX) NOT NULL,
    user_id           STRING(MAX) NOT NULL,
    credential_id     STRING(MAX) NOT NULL,
    public_key        BYTES(MAX)  NOT NULL,
    aaguid            BYTES(MAX),
    attestation_type  STRING(MAX),
    transports        ARRAY<STRING(MAX)> NOT NULL,
    sign_count        INT64       NOT NULL DEFAULT (0),
    backup_eligible   BOOL        NOT NULL DEFAULT (FALSE),
    backup_state      BOOL        NOT NULL DEFAULT (FALSE),
    name              STRING(MAX),
    verified_at       TIMESTAMP,
    last_used_at      TIMESTAMP,
    created_at        TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at        TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_user_passkeys_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_user_passkeys_credential_id CHECK (credential_id <> ''),
    CONSTRAINT chk_user_passkeys_sign_count CHECK (sign_count >= 0),
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_passkeys_credential
    ON user_passkeys (project_id, user_id, credential_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_passkeys_credential
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_passkeys
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_recovery_codes_user
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_recovery_codes
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_totp_user
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_totp
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_passwords_user
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_passwords
-- +goose StatementEnd
