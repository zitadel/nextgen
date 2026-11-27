-- +goose NO TRANSACTION
-- +goose Up
-- created_at becomes the commit timestamp, so a project's events sort in the
-- order they commit and a cursor never passes one that commits later (ADR 049,
-- amendment of 2026-10-30). A commit timestamp column takes no default but
-- PENDING_COMMIT_TIMESTAMP(), and InsertEvent always writes one.
-- +goose StatementBegin
ALTER TABLE events ALTER COLUMN created_at DROP DEFAULT
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE events ALTER COLUMN created_at SET OPTIONS (allow_commit_timestamp = true)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE events ALTER COLUMN created_at SET OPTIONS (allow_commit_timestamp = null)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE events ALTER COLUMN created_at SET DEFAULT (CURRENT_TIMESTAMP())
-- +goose StatementEnd
