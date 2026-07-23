-- +goose Up
ALTER TABLE zitadel_nextgen.projects
    ADD COLUMN name TEXT NOT NULL;

-- +goose Down
ALTER TABLE zitadel_nextgen.projects
    DROP COLUMN name;