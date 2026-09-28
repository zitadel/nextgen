-- +goose Up
-- +goose StatementBegin
-- An identity link pins one provider subject on one connection to one user; see
-- the postgres migration for why the user FK cascades (ADR 024, "External
-- systems are modeled as provisioning authorities") and why there is no project
-- FK. The connection FK is NO ACTION: connection deletion is #1013's decision.
-- Not RESTRICT: NO ACTION is checked at the end of the whole statement, so a
-- project delete that removes the link through the user cascade passes, while
-- a direct delete of a linked connection still fails. created_at is unix nanos
-- stamped in Go, as everywhere else in this dialect.
CREATE TABLE idp_identity_links (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    connection_id   TEXT    NOT NULL,
    subject         TEXT    NOT NULL,
    user_id         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_idp_identity_links_id CHECK (id <> ''),
    CONSTRAINT chk_idp_identity_links_subject CHECK (subject <> ''),
    CONSTRAINT fk_idp_identity_links_connection
        FOREIGN KEY (project_id, connection_id)
        REFERENCES idp_connections (project_id, id) ON DELETE NO ACTION,
    CONSTRAINT fk_idp_identity_links_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The only constraint a create can trip; see the postgres migration.
CREATE UNIQUE INDEX uq_idp_identity_links_connection_subject
    ON idp_identity_links (project_id, connection_id, subject);
-- +goose StatementEnd

-- +goose StatementBegin
-- Drives the user-delete cascade; see the postgres migration.
CREATE INDEX idx_idp_identity_links_project_user
    ON idp_identity_links (project_id, user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_idp_identity_links_project_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_idp_identity_links_connection_subject;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS idp_identity_links;
-- +goose StatementEnd
