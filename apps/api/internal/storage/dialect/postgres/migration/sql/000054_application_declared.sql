-- +goose Up
-- Who writes the application, fixed for its life: true for one a release
-- declares, whose one writer is the release build, and false for one
-- registered through POST /applications (ADR 082 section 1).
ALTER TABLE zitadel_nextgen.applications
    ADD COLUMN declared BOOLEAN NOT NULL DEFAULT FALSE;

-- A variable a declared client names as its secret. The name stays that
-- client's once named, even after a revision names another, so no other
-- client in the project can name it and be handed its secret (ADR 082
-- section 3). Like a client row, a claim is never deleted.
CREATE TABLE zitadel_nextgen.application_secret_variables (
    project_id TEXT COLLATE "C" NOT NULL
    , name TEXT COLLATE "C" NOT NULL CHECK (name <> '')
    , application_client_id TEXT COLLATE "C" NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, name)
    , CONSTRAINT fk_application_secret_variables_client
        FOREIGN KEY (project_id, application_client_id)
        REFERENCES zitadel_nextgen.application_clients (project_id, id)
        ON DELETE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.application_secret_variables;
ALTER TABLE zitadel_nextgen.applications
    DROP COLUMN IF EXISTS declared;
