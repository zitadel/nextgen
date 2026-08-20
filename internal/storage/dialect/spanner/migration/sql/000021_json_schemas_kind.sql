-- +goose NO TRANSACTION
-- +goose Up
-- Promote the document's `kind` discriminator to a column so schemas can be
-- listed by kind without reading every payload. Schemas persisted without
-- their document being parsed are recorded as 'unknown' (see #812), which no
-- kind filter matches.
--
-- The DEFAULT is required by Spanner, not by the data: it rejects
-- `ADD COLUMN ... NOT NULL` on an existing table outright, empty or not
-- ("Cannot add NOT NULL column ... to existing table"). Postgres and SQLite
-- accept the column without one and do not declare it. No write relies on it
-- either way — every INSERT names `kind` explicitly.
-- +goose StatementBegin
ALTER TABLE json_schemas ADD COLUMN kind STRING(256) NOT NULL DEFAULT ('unknown')
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE json_schemas DROP COLUMN kind
-- +goose StatementEnd
