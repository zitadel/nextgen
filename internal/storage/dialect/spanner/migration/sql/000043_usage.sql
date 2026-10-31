-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000039_usage.sql).
-- +goose StatementBegin
CREATE TABLE usage_first_seen (
    project_id  STRING(MAX) NOT NULL,
    meter       STRING(MAX) NOT NULL,
    month       TIMESTAMP NOT NULL,
    user_id     STRING(MAX) NOT NULL
) PRIMARY KEY (project_id, meter, month, user_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE usage_hours (
    project_id  STRING(MAX) NOT NULL,
    meter       STRING(MAX) NOT NULL,
    hour        TIMESTAMP NOT NULL,
    value       INT64 NOT NULL
) PRIMARY KEY (project_id, meter, hour)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE usage_cursors (
    project_id      STRING(MAX) NOT NULL,
    counted_before  TIMESTAMP NOT NULL,
    last_event_id   STRING(MAX) NOT NULL,
    CONSTRAINT fk_usage_cursors_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS usage_cursors
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS usage_hours
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS usage_first_seen
-- +goose StatementEnd
