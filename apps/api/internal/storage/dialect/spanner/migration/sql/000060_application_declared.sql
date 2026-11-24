-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE applications ADD COLUMN declared BOOL NOT NULL DEFAULT (FALSE)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE application_secret_variables (
    project_id             STRING(MAX) NOT NULL,
    name                   STRING(MAX) NOT NULL,
    application_client_id  STRING(MAX) NOT NULL,
    created_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_application_secret_variables_name CHECK (name <> ''),
    CONSTRAINT fk_application_secret_variables_client
        FOREIGN KEY (project_id, application_client_id)
        REFERENCES application_clients (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, name)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS application_secret_variables
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE applications DROP COLUMN declared
-- +goose StatementEnd
