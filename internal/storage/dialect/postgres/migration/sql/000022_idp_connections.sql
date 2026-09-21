-- +goose Up
-- An identity provider connection is strictly revisioned: every edit appends a
-- revision, so an in-flight auth attempt or a release can pin the revision it
-- started on and keep reading it unchanged. This table carries identity only:
-- nothing here records which revision is newest, per ADR 063 section 7.
-- Identity links key on the connection id; schemas and flow definitions
-- reference the slug.
CREATE TABLE zitadel_nextgen.idp_connections (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , slug TEXT COLLATE "C" NOT NULL CHECK (slug <> '')
    -- No updated_at: a connection's last edit is the creation of its newest
    -- revision, so every read serves that revision's created_at and a column
    -- here could only disagree with it.
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

-- The only user-reachable unique constraint on this table besides the PK, which
-- the PK cannot collide on (the id is dialect-minted). Spanner reports empty
-- constraint names, so a uniqueness violation is unambiguous while this is the
-- single candidate a create can trip; the revisions table has one of its own,
-- which only a revise can trip.
CREATE UNIQUE INDEX uq_idp_connections_project_slug
    ON zitadel_nextgen.idp_connections (project_id, slug);

-- Connections list oldest-first by keyset; id breaks created_at ties.
CREATE INDEX idx_idp_connections_project_created_at
    ON zitadel_nextgen.idp_connections (project_id, created_at, id);

-- One revision of one connection. Rows are never updated: a revision is the
-- immutable thing a release pointer or an auth attempt pins.
CREATE TABLE zitadel_nextgen.idp_connection_revisions (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , connection_id TEXT COLLATE "C" NOT NULL
    -- The configuration document, opaque to storage: the API contract owns its
    -- shape, and nothing here filters or orders on a field inside it.
    , document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    -- No direct project FK: the cascade reaches revisions through the parent
    -- connection.
    , CONSTRAINT fk_idp_connection_revisions_connection
        FOREIGN KEY (project_id, connection_id)
        REFERENCES zitadel_nextgen.idp_connections (project_id, id)
        ON DELETE CASCADE
);

-- Two revisions of one connection stamped at the same instant have no newest,
-- so uniqueness rules that out (ADR 063 section 7): a second write in the same
-- instant fails loudly instead of one of the two being picked at random. The
-- same index is the seek the newest-revision anti-join uses and the newest-first
-- walk the history list pages on: a btree scans backward, so the ascending
-- definition covers both directions.
CREATE UNIQUE INDEX uq_idp_connection_revisions_connection_created_at
    ON zitadel_nextgen.idp_connection_revisions (project_id, connection_id, created_at);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.uq_idp_connection_revisions_connection_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.idp_connection_revisions;
DROP INDEX IF EXISTS zitadel_nextgen.idx_idp_connections_project_created_at;
DROP INDEX IF EXISTS zitadel_nextgen.uq_idp_connections_project_slug;
DROP TABLE IF EXISTS zitadel_nextgen.idp_connections;
