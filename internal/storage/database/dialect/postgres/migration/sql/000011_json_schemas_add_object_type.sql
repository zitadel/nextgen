-- +goose Up
ALTER TABLE zitadel_nextgen.json_schemas
ADD COLUMN object_type VARCHAR(256) COLLATE "C";

-- +goose Down
ALTER TABLE zitadel_nextgen.json_schemas
DROP COLUMN object_type;
