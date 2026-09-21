-- +goose Up
-- An identity provider connection is strictly revisioned: every edit appends a
-- revision and moves the head pointer here, so an in-flight auth attempt or a
-- release can pin the revision it started on and keep reading it unchanged.
-- Identity links key on the connection id; schemas and flow definitions
-- reference the slug.
CREATE TABLE zitadel_nextgen.idp_connections (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , slug TEXT COLLATE "C" NOT NULL CHECK (slug <> '')
    -- Head pointer; deliberately no FK: the revision row points back here and
    -- closing the loop would make the paired insert order-impossible.
    , latest_revision_id TEXT COLLATE "C" NOT NULL CHECK (latest_revision_id <> '')
    -- No updated_at: a connection's last edit is the creation of the revision
    -- its head names, so every read serves that revision's created_at and a
    -- column here could only disagree with it.
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

-- The only user-reachable unique constraint besides the PK, which the PK cannot
-- collide on (the id is dialect-minted). Spanner reports empty constraint
-- names, so a uniqueness violation is unambiguous while this is the single
-- candidate.
CREATE UNIQUE INDEX uq_idp_connections_project_slug
    ON zitadel_nextgen.idp_connections (project_id, slug);

-- Connections list oldest-first by keyset; id breaks created_at ties.
CREATE INDEX idx_idp_connections_project_created_at
    ON zitadel_nextgen.idp_connections (project_id, created_at, id);

-- One revision of one connection. Rows are never updated: a revision is the
-- immutable thing a pointer pins.
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

-- Reading a connection's history walks the child rows by parent, and the
-- revision keyset rides along so the same index also carries the newest-first
-- walk the history list pages on: a btree scans backward, so the ascending
-- definition covers both directions.
CREATE INDEX idx_idp_connection_revisions_connection
    ON zitadel_nextgen.idp_connection_revisions (project_id, connection_id, created_at, id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_idp_connection_revisions_connection;
DROP TABLE IF EXISTS zitadel_nextgen.idp_connection_revisions;
DROP INDEX IF EXISTS zitadel_nextgen.idx_idp_connections_project_created_at;
DROP INDEX IF EXISTS zitadel_nextgen.uq_idp_connections_project_slug;
DROP TABLE IF EXISTS zitadel_nextgen.idp_connections;
