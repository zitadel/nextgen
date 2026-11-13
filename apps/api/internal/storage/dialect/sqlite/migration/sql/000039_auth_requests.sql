-- +goose Up
-- +goose StatementBegin
-- An authorization request; see the postgres migration. scopes is a JSON
-- array, as tokens.scope is; times are unix nanos set in Go.
CREATE TABLE auth_requests (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    client_id       TEXT    NOT NULL,
    redirect_uri    TEXT    NOT NULL,
    state           TEXT    NOT NULL,
    scopes          TEXT    NOT NULL,
    code_challenge  TEXT    NOT NULL,
    issuer          TEXT    NOT NULL,
    deployment_id   TEXT    NOT NULL,
    release_id      TEXT    NOT NULL,
    binding_hash    TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_auth_requests_id CHECK (id <> ''),
    CONSTRAINT fk_auth_requests_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS auth_requests;
-- +goose StatementEnd