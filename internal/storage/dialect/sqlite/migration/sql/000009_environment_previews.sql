-- +goose Up
-- +goose StatementBegin
-- Environments split into two classes: the one live environment every
-- project has, and preview environments created on demand that share the
-- project's data, resolve by request origin and expire on their own.
ALTER TABLE environments ADD COLUMN class TEXT NOT NULL DEFAULT 'live';
-- +goose StatementEnd
-- +goose StatementBegin
-- Unix nanos, as everywhere in this dialect. NULL on live: it never expires.
ALTER TABLE environments ADD COLUMN expires_at INTEGER;
-- +goose StatementEnd
-- +goose StatementBegin
-- JSON array of lowercased origins that resolve to this environment. NULL on
-- live: a request matching no preview origin is served by live.
ALTER TABLE environments ADD COLUMN origins TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE environments DROP COLUMN origins;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE environments DROP COLUMN expires_at;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE environments DROP COLUMN class;
-- +goose StatementEnd
