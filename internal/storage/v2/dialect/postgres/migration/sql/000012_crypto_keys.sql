-- +goose Up
CREATE TABLE zitadel_nextgen.encryption_keys
(
    project_id   TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id)
            ON DELETE CASCADE,
    id           TEXT COLLATE "C" NOT NULL CHECK (id <> ''),
    key          TEXT             NOT NULL CHECK (key <> ''),
    algorithm    TEXT             NOT NULL CHECK (algorithm <> ''),
    state        TEXT             NOT NULL CHECK (state <> ''),
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ NULL,
    retired_at   TIMESTAMPTZ NULL,
    purpose      TEXT             NOT NULL CHECK (purpose <> ''),
    PRIMARY KEY (project_id, id)
);

-- A project has at most one active key per purpose. These partial unique
-- indexes enforce that invariant and back the active-key lookup
-- (project_id + state = 'active' + purpose).
CREATE UNIQUE INDEX uq_keks_active_per_project
    ON zitadel_nextgen.encryption_keys (project_id) WHERE state = 'active' AND purpose = 'kek';
CREATE UNIQUE INDEX uq_token_encryption_keys_active_per_project
    ON zitadel_nextgen.encryption_keys (project_id) WHERE state = 'active' AND purpose = 'token';
CREATE UNIQUE INDEX uq_secret_encryption_keys_active_per_project
    ON zitadel_nextgen.encryption_keys (project_id) WHERE state = 'active' AND purpose = 'secret';
CREATE UNIQUE INDEX uq_cookie_encryption_keys_active_per_project
    ON zitadel_nextgen.encryption_keys (project_id) WHERE state = 'active' AND purpose = 'cookie';

CREATE TABLE zitadel_nextgen.signing_keys
(
    project_id   TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id)
            ON DELETE CASCADE,
    id           TEXT COLLATE "C" NOT NULL CHECK (id <> ''),
    key          TEXT             NOT NULL CHECK (key <> ''),
    algorithm    TEXT             NOT NULL CHECK (algorithm <> ''),
    state        TEXT             NOT NULL CHECK (state <> ''),
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ NULL,
    retired_at   TIMESTAMPTZ NULL,
    purpose      TEXT             NOT NULL CHECK (purpose <> ''),
    PRIMARY KEY (project_id, id)
);

CREATE UNIQUE INDEX uq_token_signing_keys_active_per_project
    ON zitadel_nextgen.signing_keys (project_id) WHERE state = 'active' AND purpose = 'token';

-- +goose Down
DROP INDEX IF EXISTS uq_keks_active_per_project;
DROP INDEX IF EXISTS uq_token_encryption_keys_active_per_project;
DROP INDEX IF EXISTS uq_secret_encryption_keys_active_per_project;
DROP INDEX IF EXISTS uq_cookie_encryption_keys_active_per_project;
DROP TABLE IF EXISTS zitadel_nextgen.encryption_keys;

DROP INDEX IF EXISTS uq_token_signing_keys_active_per_project;
DROP TABLE IF EXISTS zitadel_nextgen.signing_keys;
