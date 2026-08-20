-- +goose NO TRANSACTION
-- +goose Up
-- Promote the document's `kind` discriminator to a column so schemas can be
-- listed by kind without reading every payload. Schemas persisted without
-- their document being parsed are recorded as 'unknown' (see #812), which no
-- kind filter matches.
-- +goose StatementBegin
ALTER TABLE json_schemas ADD COLUMN kind STRING(256) NOT NULL DEFAULT ('unknown')
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE json_schemas DROP COLUMN kind
-- +goose StatementEnd
