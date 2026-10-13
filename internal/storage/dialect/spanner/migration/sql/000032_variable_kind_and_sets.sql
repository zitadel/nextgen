-- +goose NO TRANSACTION
-- +goose Up
-- A variable now says which kind of target it applies to, primary or preview,
-- and a deployment keeps the values it was created with as a frozen set
-- (ADR 069). See the postgres migration for the shape of each table and why;
-- this file notes where Spanner differs.
--
-- Recreated rather than altered: a Spanner primary key cannot change in place
-- (see 000031), and nothing stored is kept, so every dialect drops the rows
-- and behaves the same.
-- +goose StatementBegin
DROP TABLE variables
-- +goose StatementEnd
-- +goose StatementBegin
-- One row per variable: a value entered by one project under one name, for
-- one kind of target. A value that applies to both kinds is two rows.
CREATE TABLE variables (
    project_id       STRING(MAX) NOT NULL,
    name             STRING(MAX) NOT NULL,
    -- The target the value applies to, held as the name rather than a number
    -- so a reordering of the Go constants cannot reinterpret rows already
    -- written; the CHECK is the enum.
    kind             STRING(16)  NOT NULL,
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL DEFAULT (FALSE),
    created_at       TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    CONSTRAINT variables_project_not_empty CHECK (project_id != ''),
    CONSTRAINT chk_variables_kind CHECK (kind = 'primary' OR kind = 'preview'),
    CONSTRAINT fk_variables_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
-- The natural key, leading with the project so it also serves a read of one
-- project and the cascade when a project is deleted. See the postgres
-- migration.
) PRIMARY KEY (project_id, name, kind)
-- +goose StatementEnd
-- +goose StatementBegin
-- The values a deployment was created with, one immutable JSON document per
-- distinct set of values in a project, keyed by a SHA-256 computed in Go. See
-- the postgres migration for why the hash is computed in Go rather than from
-- the column -- Spanner's JSON type is the reason -- and why a set is never
-- shared across projects.
--
-- The column is content_hash, as on releases: HASH is a reserved word in
-- GoogleSQL, and the name spares every statement from quoting it.
CREATE TABLE variable_sets (
    project_id      STRING(MAX) NOT NULL,
    content_hash    STRING(64)  NOT NULL,
    -- {"NAME":{"value":<json>,"secret":bool}}: one kind's values, resolved
    -- before the freeze. A secret is held as its ciphertext; see the postgres
    -- migration.
    entries         JSON        NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_variable_sets_content_hash CHECK (CHAR_LENGTH(content_hash) = 64),
    CONSTRAINT chk_variable_sets_entries CHECK (JSON_TYPE(entries) = 'object'),
    CONSTRAINT fk_variable_sets_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, content_hash)
-- +goose StatementEnd
-- +goose StatementBegin
-- Which set a deployment runs with: one row per deployment, written in the
-- deployment's transaction. The three keys are the postgres ones -- see that
-- migration for why the project key stands beside the deployment key, and why
-- the set key is NO ACTION. Spanner creates the index a foreign key needs
-- itself, so the postgres idx_deployment_variable_sets_set has no counterpart
-- here: the set key's backing index is the reverse lookup.
CREATE TABLE deployment_variable_sets (
    project_id      STRING(MAX) NOT NULL,
    deployment_id   STRING(MAX) NOT NULL,
    kind            STRING(16)  NOT NULL,
    set_hash        STRING(64)  NOT NULL,
    CONSTRAINT chk_deployment_variable_sets_kind CHECK (kind = 'primary' OR kind = 'preview'),
    CONSTRAINT fk_deployment_variable_sets_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_deployment_variable_sets_deployment
        FOREIGN KEY (project_id, deployment_id)
        REFERENCES deployments (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_deployment_variable_sets_set
        FOREIGN KEY (project_id, set_hash)
        REFERENCES variable_sets (project_id, content_hash)
        ON DELETE NO ACTION
) PRIMARY KEY (project_id, deployment_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- The link references both new tables, so it goes first.
-- +goose StatementBegin
DROP TABLE IF EXISTS deployment_variable_sets
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS variable_sets
-- +goose StatementEnd
-- Back to the 000031 shape, which has no kind. The rows are dropped again:
-- two kinds cannot collapse into a key that has none.
-- +goose StatementBegin
DROP TABLE variables
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL DEFAULT (FALSE),
    created_at       TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    CONSTRAINT variables_project_not_empty CHECK (project_id != ''),
    CONSTRAINT fk_variables_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (name, project_id)
-- +goose StatementEnd
