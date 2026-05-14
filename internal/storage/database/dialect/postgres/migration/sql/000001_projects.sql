-- +goose Up
-- Create schema, in case the script is run independently.
CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.projects(
    id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , project_secret TEXT     NOT NULL DEFAULT '' CHECK (project_secret <> '')
    , preview_secret TEXT     NOT NULL DEFAULT '' CHECK (preview_secret <> '')
    , preview_origins TEXT    NOT NULL DEFAULT '[]'

    , PRIMARY KEY (id)
);

-- +goose Down
DROP TABLE zitadel_nextgen.projects;
