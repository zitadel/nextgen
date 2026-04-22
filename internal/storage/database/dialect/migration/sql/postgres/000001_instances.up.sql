CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.instances (
    id         TEXT        NOT NULL CHECK (id <> '')
    , created_at TIMESTAMPTZ NOT NULL
    , updated_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (id)
);
