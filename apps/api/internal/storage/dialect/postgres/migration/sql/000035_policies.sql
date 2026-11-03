-- +goose Up
-- An operation policy (ADR 066) is revisioned like an identity provider
-- connection (ADR 063): this table carries the policy's identity, one row per
-- operation per project, and no column records which revision is newest.
CREATE TABLE zitadel_nextgen.policies (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    -- The operation is the policy's handle: a project has at most one policy
    -- per operation.
    , operation TEXT COLLATE "C" NOT NULL CHECK (operation <> '')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

-- The only constraint a first publish can trip: two concurrent first
-- publishes of one operation, where the second has to publish on top of the
-- first instead.
CREATE UNIQUE INDEX uq_policies_project_operation
    ON zitadel_nextgen.policies (project_id, operation);

-- One revision of one policy; rows are never updated. The config is opaque to
-- storage: the operation's template owns its shape.
CREATE TABLE zitadel_nextgen.policy_revisions (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , policy_id TEXT COLLATE "C" NOT NULL
    , config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object')
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_policy_revisions_policy
        FOREIGN KEY (project_id, policy_id)
        REFERENCES zitadel_nextgen.policies (project_id, id)
        ON DELETE CASCADE
);

-- Two revisions of one policy stamped at the same instant have no newest
-- (ADR 063 section 7), so the second write fails. The index also serves the
-- newest-revision lookup a password set makes.
CREATE UNIQUE INDEX uq_policy_revisions_policy_created_at
    ON zitadel_nextgen.policy_revisions (project_id, policy_id, created_at);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.uq_policy_revisions_policy_created_at;
DROP TABLE IF EXISTS zitadel_nextgen.policy_revisions;
DROP INDEX IF EXISTS zitadel_nextgen.uq_policies_project_operation;
DROP TABLE IF EXISTS zitadel_nextgen.policies;
