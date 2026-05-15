-- +goose Up
-- Create schema, in case the script is run independently.
CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.projects(
    id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

    /* TODO: add more columns here */

    , PRIMARY KEY (id)
);

-- +goose Down
DROP TABLE zitadel_nextgen.projects;
