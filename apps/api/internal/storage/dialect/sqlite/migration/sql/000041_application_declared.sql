-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE applications ADD COLUMN declared INTEGER NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE application_secret_variables (
    project_id             TEXT    NOT NULL,
    name                   TEXT    NOT NULL,
    application_client_id  TEXT    NOT NULL,
    created_at             INTEGER NOT NULL,
    PRIMARY KEY (project_id, name),
    CONSTRAINT chk_application_secret_variables_name CHECK (name <> ''),
    CONSTRAINT fk_application_secret_variables_client
        FOREIGN KEY (project_id, application_client_id)
        REFERENCES application_clients (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS application_secret_variables;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE applications DROP COLUMN declared;
-- +goose StatementEnd
