-- +goose Up
CREATE TABLE zitadel_nextgen.organizations (
    instance_id TEXT NOT NULL
        REFERENCES zitadel_nextgen.instances (id)
        ON DELETE CASCADE
    , id         TEXT NOT NULL
    , created_at TIMESTAMPTZ NOT NULL
    , updated_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (instance_id, id)
);

-- +goose Down
DROP TABLE zitadel_nextgen.organizations;
