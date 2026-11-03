-- +goose Up
-- An app is revisioned like an identity provider connection: this table
-- carries identity only, every write appends a revision, and no column records
-- which revision is newest (ADR 063 section 7). source says who writes the
-- app: a release build ('declared') or POST /apps ('registered'), never both.
CREATE TABLE zitadel_nextgen.apps (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , slug TEXT COLLATE "C" NOT NULL CHECK (slug <> '')
    , source TEXT COLLATE "C" NOT NULL CHECK (source IN ('declared', 'registered'))
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

-- The only constraint an app create can trip, as for connections: Spanner
-- reports empty constraint names, and the id is minted, so the primary key
-- cannot collide.
CREATE UNIQUE INDEX uq_apps_project_slug
    ON zitadel_nextgen.apps (project_id, slug);

-- Apps list oldest-first by keyset; id breaks created_at ties.
CREATE INDEX idx_apps_project_created_at
    ON zitadel_nextgen.apps (project_id, created_at, id);

-- One revision of one app; rows are never updated, because a release pins a
-- revision and expects it to stay as it was. The document is stored as
-- authored and is opaque to storage: the client ids the server minted live in
-- app_clients, so the release that sent the document can match it again.
CREATE TABLE zitadel_nextgen.app_revisions (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , app_id TEXT COLLATE "C" NOT NULL
    , document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_app_revisions_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES zitadel_nextgen.apps (project_id, id)
        ON DELETE CASCADE
);

-- No two revisions of one app share an instant (ADR 063 section 7); the index
-- also serves the newest-revision lookup and the history page.
CREATE UNIQUE INDEX uq_app_revisions_app_created_at
    ON zitadel_nextgen.app_revisions (project_id, app_id, created_at);

-- The client_id each client of an app holds. A row outlives the revisions that
-- list its client, so the token endpoint finds a client by id in one lookup, a
-- client removed and added back keeps its id, and no other client in the
-- project ever gets it. id is minted; client_id is that id unless the document
-- chose one, which is why the chosen value is a column and not the key
-- (ADR 047 section 4).
CREATE TABLE zitadel_nextgen.app_clients (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , app_id TEXT COLLATE "C" NOT NULL
    , slug TEXT COLLATE "C" NOT NULL CHECK (slug <> '')
    , client_id TEXT COLLATE "C" NOT NULL CHECK (client_id <> '')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_app_clients_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES zitadel_nextgen.apps (project_id, id)
        ON DELETE CASCADE
);

-- The only constraint a client insert can trip: a revise holds its app's lock
-- and looks the slug up first, so the slug index below cannot collide.
CREATE UNIQUE INDEX uq_app_clients_project_client_id
    ON zitadel_nextgen.app_clients (project_id, client_id);

CREATE UNIQUE INDEX uq_app_clients_app_slug
    ON zitadel_nextgen.app_clients (project_id, app_id, slug);

-- Every API identifier an app has served. An identifier is an audience, so
-- once an app used one no other app in the project may: a token minted for the
-- old API must never be accepted by a new one. The authorization server finds
-- the app here, then the API in the revision that serves the request.
CREATE TABLE zitadel_nextgen.app_api_identifiers (
    project_id TEXT COLLATE "C" NOT NULL
    , identifier TEXT COLLATE "C" NOT NULL CHECK (identifier <> '')
    , app_id TEXT COLLATE "C" NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, identifier)
    , CONSTRAINT fk_app_api_identifiers_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES zitadel_nextgen.apps (project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_app_api_identifiers_app
    ON zitadel_nextgen.app_api_identifiers (project_id, app_id);

-- A registered app's client secrets, as hashes. A declared app's secret is a
-- variable reference in its document and has no row here.
CREATE TABLE zitadel_nextgen.app_client_secrets (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , client_row_id TEXT COLLATE "C" NOT NULL
    , encoded_hash TEXT COLLATE "C" NOT NULL CHECK (encoded_hash <> '')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_app_client_secrets_client
        FOREIGN KEY (project_id, client_row_id)
        REFERENCES zitadel_nextgen.app_clients (project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_app_client_secrets_client
    ON zitadel_nextgen.app_client_secrets (project_id, client_row_id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_app_client_secrets_client;
DROP TABLE IF EXISTS zitadel_nextgen.app_client_secrets;
DROP INDEX IF EXISTS zitadel_nextgen.idx_app_api_identifiers_app;
DROP TABLE IF EXISTS zitadel_nextgen.app_api_identifiers;
DROP INDEX IF EXISTS zitadel_nextgen.uq_app_clients_app_slug;
DROP INDEX IF EXISTS zitadel_nextgen.uq_app_clients_project_client_id;
DROP TABLE IF EXISTS zitadel_nextgen.app_clients;
DROP INDEX IF EXISTS zitadel_nextgen.uq_app_revisions_app_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.app_revisions;
DROP INDEX IF EXISTS zitadel_nextgen.idx_apps_project_created_at;
DROP INDEX IF EXISTS zitadel_nextgen.uq_apps_project_slug;
DROP TABLE IF EXISTS zitadel_nextgen.apps;
