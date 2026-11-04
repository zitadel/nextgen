-- +goose Up
-- +goose StatementBegin
-- A consent records that a user let an OAuth client use some of an API's
-- scopes (ADR 082 §8), one per user, client and API; see the postgres
-- migration for why the tokens issued under it carry no foreign key to it.
-- scope is a JSON array of strings, and the timestamps are unix nanos stamped
-- in Go, as everywhere else in this dialect.
CREATE TABLE consents (
    project_id   TEXT    NOT NULL,
    id           TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    client_id    TEXT    NOT NULL,
    client_name  TEXT    NOT NULL DEFAULT (''),
    resource     TEXT    NOT NULL,
    scope        TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_consents_id CHECK (id <> ''),
    CONSTRAINT chk_consents_client_id CHECK (client_id <> ''),
    CONSTRAINT chk_consents_resource CHECK (resource <> ''),
    CONSTRAINT chk_consents_scope CHECK (json_type(scope) = 'array'),
    CONSTRAINT fk_consents_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_consents_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The constraint a create is expected to trip; see the postgres migration.
CREATE UNIQUE INDEX uq_consents_user_client_resource
    ON consents (project_id, user_id, client_id, resource);
-- +goose StatementEnd

-- +goose StatementBegin
-- A user's consents list newest first by keyset; id breaks created_at ties.
CREATE INDEX idx_consents_user_created_at
    ON consents (project_id, user_id, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
-- Deleting a client deletes its consents and the tokens issued under them.
CREATE INDEX idx_consents_client
    ON consents (project_id, client_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_consents_client;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_consents_user_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_consents_user_client_resource;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS consents;
-- +goose StatementEnd
