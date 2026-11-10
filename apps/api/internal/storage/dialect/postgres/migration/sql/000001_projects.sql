-- +goose Up
-- Create schema, in case the script is run independently.
CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE IF NOT EXISTS zitadel_nextgen.projects(
    id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , name TEXT NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , preview_origins TEXT[]    NOT NULL

    , PRIMARY KEY (id)
);

-- +goose Down
DROP TABLE zitadel_nextgen.projects;
