-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- An identity link pins one provider subject on one connection to one user; see
-- the postgres migration for why the user FK cascades (ADR 024, "External
-- systems are modeled as provisioning authorities") and why there is no project
-- FK. The connection FK is NO ACTION: connection deletion is #1013's decision.
CREATE TABLE idp_identity_links (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    connection_id   STRING(MAX) NOT NULL,
    subject         STRING(MAX) NOT NULL,
    user_id         STRING(MAX) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_idp_identity_links_id CHECK (id <> ''),
    CONSTRAINT chk_idp_identity_links_subject CHECK (subject <> ''),
    CONSTRAINT fk_idp_identity_links_connection
        FOREIGN KEY (project_id, connection_id)
        REFERENCES idp_connections (project_id, id)
        ON DELETE NO ACTION,
    CONSTRAINT fk_idp_identity_links_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- The constraint a create is expected to trip; see the postgres migration.
CREATE UNIQUE INDEX uq_idp_identity_links_connection_subject
    ON idp_identity_links (project_id, connection_id, subject)
-- +goose StatementEnd
-- +goose StatementBegin
-- Spanner already backs the user FK with an index; this one keeps the schema
-- the same as the other dialects.
CREATE INDEX idx_idp_identity_links_project_user
    ON idp_identity_links (project_id, user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_idp_identity_links_project_user
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_idp_identity_links_connection_subject
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS idp_identity_links
-- +goose StatementEnd
