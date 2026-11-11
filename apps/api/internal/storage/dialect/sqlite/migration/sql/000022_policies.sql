-- +goose Up
-- +goose StatementBegin
-- An operation policy is revisioned; see the postgres migration for why this
-- table is identity only and no column records which revision is newest.
-- created_at is unix nanos stamped in Go, as everywhere else in this dialect.
CREATE TABLE policies (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    operation   TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_policies_id CHECK (id <> ''),
    CONSTRAINT chk_policies_operation CHECK (operation <> ''),
    CONSTRAINT fk_policies_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The only constraint a first publish can trip; see the postgres migration.
CREATE UNIQUE INDEX uq_policies_project_operation
    ON policies (project_id, operation);
-- +goose StatementEnd

-- +goose StatementBegin
-- One revision of one policy; rows are never updated.
CREATE TABLE policy_revisions (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    policy_id   TEXT    NOT NULL,
    config      TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_policy_revisions_id CHECK (id <> ''),
    CONSTRAINT chk_policy_revisions_config CHECK (json_type(config) = 'object'),
    CONSTRAINT fk_policy_revisions_policy
        FOREIGN KEY (project_id, policy_id)
        REFERENCES policies (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Two revisions of one policy stamped at the same instant have no newest; see
-- the postgres migration.
CREATE UNIQUE INDEX uq_policy_revisions_policy_created_at
    ON policy_revisions (project_id, policy_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_policy_revisions_policy_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS policy_revisions;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_policies_project_operation;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS policies;
-- +goose StatementEnd
