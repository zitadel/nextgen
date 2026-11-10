-- +goose Up
-- A registered application is revisioned like an IdP connection; see
-- 000022_idp_connections.sql for why this table is identity only and has no
-- updated_at. No list index: there is no list endpoint.
CREATE TABLE zitadel_nextgen.applications (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , slug TEXT COLLATE "C" NOT NULL CHECK (slug <> '')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

CREATE UNIQUE INDEX uq_applications_project_slug
    ON zitadel_nextgen.applications (project_id, slug);

-- One revision of one application; rows are never updated. See
-- 000022_idp_connections.sql for why the document is opaque and why there is
-- no project FK here.
CREATE TABLE zitadel_nextgen.application_revisions (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , application_id TEXT COLLATE "C" NOT NULL
    , document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_application_revisions_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES zitadel_nextgen.applications (project_id, id)
        ON DELETE CASCADE
);

-- Rules out two newest revisions and serves the newest-revision lookup; see
-- 000022_idp_connections.sql.
CREATE UNIQUE INDEX uq_application_revisions_application_created_at
    ON zitadel_nextgen.application_revisions (project_id, application_id, created_at);

-- The credential of one client. A revision cannot remove a client, so no row
-- is deleted, and a client_id stays taken once held (ADR 047 section 5). The
-- cascade frees a client_id when its application is deleted; the PR that adds
-- deletion owns the contract's promise that an id once held is never reused.
CREATE TABLE zitadel_nextgen.application_clients (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , application_id TEXT COLLATE "C" NOT NULL
    , slug TEXT COLLATE "C" NOT NULL CHECK (slug <> '')
    , client_id TEXT COLLATE "C" NOT NULL CHECK (client_id <> '')
    -- Hex SHA-256 from domain.HashSecret.
    , secret_hash TEXT COLLATE "C" NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_application_clients_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES zitadel_nextgen.applications (project_id, id)
        ON DELETE CASCADE
);

-- A create or revision can trip the application slug, revision created_at or
-- client_id index inside one transaction, and sqlite and Spanner report an
-- empty constraint name. The service tells them apart by reading state after
-- the transaction has rolled back; applicationService.create and revise hold
-- the order.
CREATE UNIQUE INDEX uq_application_clients_project_client_id
    ON zitadel_nextgen.application_clients (project_id, client_id);

-- Catches a bug that inserts the same slug twice and leaves a hidden
-- credential; it surfaces as one of the two errors above, which is acceptable
-- because the domain rejects duplicate slugs before any write. Also serves the
-- by-application list a revision needs.
CREATE UNIQUE INDEX uq_application_clients_application_slug
    ON zitadel_nextgen.application_clients (project_id, application_id, slug);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.uq_application_clients_application_slug;
DROP INDEX IF EXISTS zitadel_nextgen.uq_application_clients_project_client_id;
DROP TABLE IF EXISTS zitadel_nextgen.application_clients;
DROP INDEX IF EXISTS zitadel_nextgen.uq_application_revisions_application_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.application_revisions;
DROP INDEX IF EXISTS zitadel_nextgen.uq_applications_project_slug;
DROP TABLE IF EXISTS zitadel_nextgen.applications;
