CREATE TABLE zitadel_nextgen.organizations(
    instance_id TEXT NOT NULL
    REFERENCES zitadel_nextgen.instances (id)
    ON DELETE CASCADE
    , id TEXT NOT NULL
    , created_at TIMESTAMPTZ NOT NULL
    , updated_at TIMESTAMPTZ NOT NULL

    /* TODO: add more columns here */

    , PRIMARY KEY (instance_id, id)
);
