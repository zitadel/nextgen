-- +goose Up
CREATE TABLE zitadel_nextgen.passkey_registrations (
    id          TEXT        NOT NULL PRIMARY KEY
    , project_id  TEXT COLLATE "C" NOT NULL
    , user_id     TEXT COLLATE "C" NOT NULL
    , challenge   JSONB       NOT NULL
    , expires_at  TIMESTAMPTZ NOT NULL
    , created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    , CONSTRAINT fk_passkey_registrations_project
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_passkey_registrations_expires_at
    ON zitadel_nextgen.passkey_registrations (expires_at);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.passkey_registrations;
