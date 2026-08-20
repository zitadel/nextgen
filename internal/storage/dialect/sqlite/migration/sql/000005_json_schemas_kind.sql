-- +goose Up
-- Promote the document's `kind` discriminator to a column so schemas can be
-- listed by kind without reading every payload. Nullable: schemas ingested by
-- URL and $ref targets fetched during resolution are stored without it (#812),
-- and a NULL kind is excluded from a kind-filtered list.
-- +goose StatementBegin
ALTER TABLE json_schemas ADD COLUMN kind TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE json_schemas DROP COLUMN kind;
-- +goose StatementEnd
