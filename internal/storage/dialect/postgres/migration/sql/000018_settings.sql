-- +goose Up
-- One row per setting leaf: a value written at one owner level for one path.
--
-- Owner ids are NOT NULL with an empty-string default rather than nullable.
-- Empty means "not scoped at this level", which keeps the natural key usable as
-- a primary key (a nullable column cannot be), makes uniqueness per owner
-- enforceable without NULLS NOT DISTINCT, and matches the domain, where the
-- unset owner id is also "". The cost is that project_id cannot carry a foreign
-- key to projects, since root-level leaves store '' rather than a project id.
CREATE TABLE zitadel_nextgen.settings (
    path             TEXT NOT NULL CHECK (path <> '')
    , project_id     TEXT NOT NULL DEFAULT ''
    , team_id        TEXT NOT NULL DEFAULT ''
    , application_id TEXT NOT NULL DEFAULT ''
    , user_id        TEXT NOT NULL DEFAULT ''
    , value          JSONB NOT NULL
    , is_final       BOOLEAN NOT NULL DEFAULT FALSE
    , created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    -- The natural key. Making it the primary key is what stops two leaves from
    -- existing at the same owner for one path, which would otherwise make
    -- resolution order between them arbitrary.
    , PRIMARY KEY (path, project_id, team_id, application_id, user_id)

    -- A leaf cannot be owned at a level whose ancestors are unset; without this
    -- an owner such as (team_id set, project_id '') would be readable by any
    -- project, since the empty project_id reads as a wildcard.
    , CONSTRAINT settings_owner_chain CHECK (
        (project_id <> '' OR (team_id = '' AND application_id = '' AND user_id = ''))
        AND (team_id <> '' OR (application_id = '' AND user_id = ''))
        AND (application_id <> '' OR user_id = '')
    )
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.settings;
