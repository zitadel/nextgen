-- +goose Up
-- Promote the document's `kind` discriminator to a column so schemas can be
-- listed by kind without reading every payload. Schemas persisted without
-- their document being parsed are recorded as 'unknown' (see #812), which no
-- kind filter matches.
ALTER TABLE zitadel_nextgen.json_schemas
    ADD COLUMN kind TEXT COLLATE "C" NOT NULL DEFAULT 'unknown';

-- +goose Down
ALTER TABLE zitadel_nextgen.json_schemas
    DROP COLUMN kind;
