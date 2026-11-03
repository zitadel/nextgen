-- +goose Up
-- See the postgres peer (000039_usage.sql). Times are unix nanoseconds.
-- +goose StatementBegin
CREATE TABLE usage_first_seen (
    project_id  TEXT NOT NULL,
    meter       TEXT NOT NULL,
    month       INTEGER NOT NULL,
    user_id     TEXT NOT NULL,
    PRIMARY KEY (project_id, meter, month, user_id)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE usage_hours (
    project_id  TEXT NOT NULL,
    meter       TEXT NOT NULL,
    hour        INTEGER NOT NULL,
    value       INTEGER NOT NULL,
    PRIMARY KEY (project_id, meter, hour)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE usage_cursors (
    project_id      TEXT NOT NULL,
    counted_before  INTEGER NOT NULL,
    last_event_id   TEXT NOT NULL,
    PRIMARY KEY (project_id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS usage_cursors;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS usage_hours;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS usage_first_seen;
-- +goose StatementEnd
