-- +goose Up
-- A consent records that a user let an OAuth client use some of an API's
-- scopes (ADR 082 §8), one per user, client and API. It is kept like a
-- session: transient, with an idle deadline each use moves (ADR 072). The
-- codes and refresh tokens issued under it are tokens rows that name it as
-- their oidc_session_id. No foreign key ties them to it, so the consent
-- statements delete them with it.
CREATE TABLE zitadel_nextgen.consents (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , user_id TEXT COLLATE "C" NOT NULL
    -- An app client's id, a registration's, or the URL of a client ID
    -- metadata document, so unbounded.
    , client_id TEXT COLLATE "C" NOT NULL CHECK (client_id <> '')
    -- The name the client went by when the user consented, for the user to
    -- recognise it; nothing filters or orders on it.
    , client_name TEXT NOT NULL DEFAULT ''
    -- The API's identifier, the aud of the tokens issued under the consent.
    , resource TEXT COLLATE "C" NOT NULL CHECK (resource <> '')
    , scope TEXT[] NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    , expires_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , CONSTRAINT fk_consents_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users (project_id, id)
        ON DELETE CASCADE
);

-- One consent per user, client and API. The id is minted by the dialect, so
-- this is the constraint a create is expected to trip: two authorizations of
-- one user and client racing to create the consent. Its (project_id, user_id)
-- prefix also drives the user-delete cascade.
CREATE UNIQUE INDEX uq_consents_user_client_resource
    ON zitadel_nextgen.consents (project_id, user_id, client_id, resource);

-- A user's consents list newest first by keyset; id breaks created_at ties.
CREATE INDEX idx_consents_user_created_at
    ON zitadel_nextgen.consents (project_id, user_id, created_at DESC, id DESC);

-- Deleting a client deletes its consents and the tokens issued under them.
CREATE INDEX idx_consents_client
    ON zitadel_nextgen.consents (project_id, client_id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_consents_client;
DROP INDEX IF EXISTS zitadel_nextgen.idx_consents_user_created_at;
DROP INDEX IF EXISTS zitadel_nextgen.uq_consents_user_client_resource;
DROP TABLE IF EXISTS zitadel_nextgen.consents;
