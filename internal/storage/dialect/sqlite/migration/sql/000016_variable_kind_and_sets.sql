-- +goose Up
-- A variable now says which kind of target it applies to, primary or preview,
-- and a deployment keeps the values it was created with as a frozen set
-- (ADR 069). See the postgres migration for what each table and column is
-- for; what differs here is the storage: JSON held in TEXT columns pinned by
-- json_type, and created_at as unix nanos stamped in Go, as everywhere else
-- in this dialect.
--
-- The variables table is dropped and recreated: SQLite cannot change a
-- primary key in place, and there is no data to keep, since the product is in
-- alpha and every dialect drops the rows the same way. The drop takes
-- idx_variables_project_name with it, which the new key makes redundant.
-- +goose StatementBegin
DROP TABLE variables;
-- +goose StatementEnd

-- +goose StatementBegin
-- One row per variable: a value entered by one project under one name, for
-- one kind of target. A value that applies to both kinds is two rows, one per
-- kind, and nothing falls back from one kind to the other.
CREATE TABLE variables (
    project_id   TEXT    NOT NULL CHECK (project_id <> ''),
    name         TEXT    NOT NULL CHECK (name <> ''),
    -- The target the value applies to. Held as the name rather than a number
    -- so a reordering of the Go constants cannot reinterpret rows already
    -- written; the CHECK is the enum.
    kind         TEXT    NOT NULL CHECK (kind IN ('primary', 'preview')),
    value        TEXT    NOT NULL,
    is_secret    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    modified_at  INTEGER NOT NULL,
    -- The natural key, which is the upsert conflict target and the only way
    -- to address a row. It leads with project_id, so it also serves a read of
    -- one project and the project cascade, which is what the old key needed
    -- idx_variables_project_name for.
    PRIMARY KEY (project_id, name, kind),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The values a deployment was created with, frozen as one immutable JSON
-- document per distinct set of values in a project. content_hash is the
-- SHA-256 of the entries, computed in Go and named as releases.content_hash
-- is; the key is what makes identical values one row. Sets are per project
-- and never shared across projects.
CREATE TABLE variable_sets (
    project_id   TEXT    NOT NULL,
    content_hash TEXT    NOT NULL,
    -- {"NAME":{"value":<json>,"secret":bool}}: one kind's values, resolved
    -- before the freeze, so an entry carries no kind. A secret is held as the
    -- ciphertext the variables table held -- a freeze never decrypts -- and
    -- the hash covers that ciphertext, never the plaintext.
    entries      TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, content_hash),
    CONSTRAINT chk_variable_sets_content_hash CHECK (length(content_hash) = 64),
    CONSTRAINT chk_variable_sets_entries CHECK (json_type(entries) = 'object'),
    CONSTRAINT fk_variable_sets_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Which set a deployment runs with: one row per deployment, written in the
-- deployment's transaction. kind records which rows were frozen, since the
-- set itself does not say.
CREATE TABLE deployment_variable_sets (
    project_id     TEXT NOT NULL,
    deployment_id  TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('primary', 'preview')),
    set_hash       TEXT NOT NULL,
    PRIMARY KEY (project_id, deployment_id),
    -- A direct project key beside the deployment key, the shape the postgres
    -- migration explains: there it is what lets a project with frozen
    -- deployments be deleted at all. SQLite checks an immediate foreign key
    -- once the whole statement is done, cascades included, so it would cope
    -- without it; the key is kept so the three dialects hold the same
    -- constraints and the same cascade. sessions has the same shape (000001).
    CONSTRAINT fk_deployment_variable_sets_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_deployment_variable_sets_deployment
        FOREIGN KEY (project_id, deployment_id)
        REFERENCES deployments (project_id, id) ON DELETE CASCADE,
    -- NO ACTION, so a set a deployment uses can never be deleted: the
    -- deployment must keep exactly the values it was created with, however
    -- the variables change later.
    CONSTRAINT fk_deployment_variable_sets_set
        FOREIGN KEY (project_id, set_hash)
        REFERENCES variable_sets (project_id, content_hash) ON DELETE NO ACTION
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The reverse lookup: which deployments use a set. It is what the NO ACTION
-- check above walks when a set is deleted, and what a collector of unused
-- sets will walk.
CREATE INDEX idx_deployment_variable_sets_set
    ON deployment_variable_sets (project_id, set_hash);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployment_variable_sets_set;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployment_variable_sets;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS variable_sets;
-- +goose StatementEnd

-- Back to the 000015 shape, which has no kind. The rows are dropped again:
-- two kinds cannot collapse into a key that has none.
-- +goose StatementBegin
DROP TABLE variables;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE variables (
    name         TEXT    NOT NULL CHECK (name <> ''),
    project_id   TEXT    NOT NULL CHECK (project_id <> ''),
    value        TEXT    NOT NULL,
    is_secret    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    modified_at  INTEGER NOT NULL,
    PRIMARY KEY (name, project_id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_variables_project_name ON variables (project_id, name);
-- +goose StatementEnd
