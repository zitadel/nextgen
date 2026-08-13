-- +goose Up
-- Wave 1 (#422): authz MVP tables aligned to #720 CatalogMutations, seed, backfill.
--
-- Relation identity is (object_type, relation). Expression edges + relation
-- references store compiled policy. Bundle tables exist but are unused by the
-- v1 compiler mapper.
--
-- Seed cat_sys_1 matches this OpenFGA-style model (placeholders pending #420):
--   type user
--   type team
--     relations
--       define member: [user]
--   type project
--     relations
--       define team: [team]
--       define viewer: [user, team#member] or member from team
--       define editor: viewer
--       define admin: [user] or editor

-- +goose StatementBegin
CREATE TABLE resource_scope_index (
    resource_id   TEXT    NOT NULL CHECK (resource_id <> ''),
    resource_kind TEXT    NOT NULL CHECK (resource_kind <> ''),
    project_id    TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    team_id       TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (resource_kind, project_id, resource_id),
    FOREIGN KEY (project_id, team_id) REFERENCES teams (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_resource_scope_index_project
    ON resource_scope_index (project_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_resource_scope_index_kind_project
    ON resource_scope_index (resource_kind, project_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_catalogs (
    id           TEXT    NOT NULL CHECK (id <> ''),
    catalog_kind TEXT    NOT NULL CHECK (catalog_kind IN ('system', 'app_group')),
    owner_id     TEXT    NOT NULL,
    version      INTEGER NOT NULL CHECK (version >= 1),
    status       TEXT    NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
    source_hash  TEXT,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (catalog_kind, owner_id, version)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX authz_catalogs_one_active
    ON authz_catalogs (catalog_kind, owner_id)
    WHERE status = 'active';
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_relations (
    catalog_id  TEXT NOT NULL REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    object_type TEXT NOT NULL CHECK (object_type <> ''),
    relation    TEXT NOT NULL CHECK (relation <> ''),
    kind        TEXT NOT NULL CHECK (kind IN ('permission', 'relation')),
    PRIMARY KEY (catalog_id, object_type, relation)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_relation_closure (
    catalog_id       TEXT    NOT NULL REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    from_object_type TEXT    NOT NULL,
    from_relation    TEXT    NOT NULL,
    to_object_type   TEXT    NOT NULL,
    to_relation      TEXT    NOT NULL,
    depth            INTEGER NOT NULL CHECK (depth >= 0),
    PRIMARY KEY (catalog_id, from_object_type, from_relation, to_object_type, to_relation),
    FOREIGN KEY (catalog_id, from_object_type, from_relation)
        REFERENCES authz_relations (catalog_id, object_type, relation),
    FOREIGN KEY (catalog_id, to_object_type, to_relation)
        REFERENCES authz_relations (catalog_id, object_type, relation)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_authz_closure_to
    ON authz_relation_closure (catalog_id, to_object_type, to_relation);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_relation_references (
    catalog_id   TEXT    NOT NULL REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    object_type  TEXT    NOT NULL,
    relation     TEXT    NOT NULL,
    ref_type     TEXT    NOT NULL CHECK (ref_type <> ''),
    ref_relation TEXT    NOT NULL DEFAULT '',
    wildcard     INTEGER NOT NULL DEFAULT 0,
    condition    TEXT    NOT NULL DEFAULT '',
    position     INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (catalog_id, object_type, relation, position),
    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation)
        ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_expression_edges (
    catalog_id           TEXT    NOT NULL REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    object_type          TEXT    NOT NULL,
    relation             TEXT    NOT NULL,
    kind                 TEXT    NOT NULL
        CHECK (kind IN ('direct', 'computed_userset', 'tuple_to_userset')),
    source_object_type   TEXT,
    source_relation      TEXT,
    tupleset_object_type TEXT,
    tupleset_relation    TEXT,
    position             INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (catalog_id, object_type, relation, position),
    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation)
        ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_bundles (
    catalog_id TEXT NOT NULL REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    bundle     TEXT NOT NULL,
    PRIMARY KEY (catalog_id, bundle)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_bundle_members (
    catalog_id  TEXT NOT NULL,
    bundle      TEXT NOT NULL,
    object_type TEXT NOT NULL,
    relation    TEXT NOT NULL,
    PRIMARY KEY (catalog_id, bundle, object_type, relation),
    FOREIGN KEY (catalog_id, bundle)
        REFERENCES authz_bundles (catalog_id, bundle)
        ON DELETE CASCADE,
    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_assignments (
    id                TEXT    NOT NULL CHECK (id <> ''),
    project_id        TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    catalog_id        TEXT    NOT NULL REFERENCES authz_catalogs (id) ON DELETE RESTRICT,
    principal_type    TEXT    NOT NULL
        CHECK (principal_type IN ('user', 'team', 'agent', 'sk_proj', 'sk_team')),
    principal_id      TEXT    NOT NULL,
    object_type       TEXT    NOT NULL CHECK (object_type <> ''),
    relation          TEXT    NOT NULL CHECK (relation <> ''),
    scope_kind        TEXT    NOT NULL
        CHECK (scope_kind IN ('project', 'team', 'resource')),
    scope_team_id     TEXT,
    scope_resource_id TEXT,
    grantor_type      TEXT,
    grantor_id        TEXT,
    delegation_id     TEXT,
    expires_at        INTEGER,
    revoked_at        INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation),
    FOREIGN KEY (project_id, scope_team_id)
        REFERENCES teams (project_id, id)
        ON DELETE CASCADE,
    CHECK (
        (scope_kind = 'project'
            AND scope_team_id IS NULL AND scope_resource_id IS NULL)
        OR (scope_kind = 'team'
            AND scope_team_id IS NOT NULL AND scope_resource_id IS NULL)
        OR (scope_kind = 'resource'
            AND scope_resource_id IS NOT NULL)
    ),
    CHECK (
        (delegation_id IS NULL AND grantor_id IS NULL)
        OR (delegation_id IS NOT NULL AND grantor_id IS NOT NULL)
    )
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_authz_assignments_principal_project
    ON authz_assignments (project_id, principal_type, principal_id)
    WHERE revoked_at IS NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_authz_assignments_delegation
    ON authz_assignments (project_id, delegation_id)
    WHERE delegation_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX authz_assignments_unique_active
    ON authz_assignments (
        project_id, catalog_id, principal_type, principal_id,
        object_type, relation, scope_kind,
        COALESCE(scope_team_id, ''),
        COALESCE(scope_resource_id, '')
    )
    WHERE revoked_at IS NULL AND delegation_id IS NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_membership_edges (
    project_id  TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    member_type TEXT    NOT NULL,
    member_id   TEXT    NOT NULL,
    set_type    TEXT    NOT NULL,
    set_id      TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, set_type, set_id, member_type, member_id),
    CHECK (member_type = 'user' AND set_type = 'team'),
    FOREIGN KEY (project_id, set_id) REFERENCES teams (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_authz_membership_edges_member
    ON authz_membership_edges (project_id, member_type, member_id);
-- +goose StatementEnd

-- System catalog seed (must match domain.SystemCatalogID).
-- +goose StatementBegin
INSERT INTO authz_catalogs (id, catalog_kind, owner_id, version, status, created_at)
VALUES ('cat_sys_1', 'system', 'system', 1, 'active', CAST(strftime('%s','now') AS INTEGER) * 1000000000);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_relations (catalog_id, object_type, relation, kind) VALUES
    ('cat_sys_1', 'team', 'member', 'relation'),
    ('cat_sys_1', 'project', 'team', 'relation'),
    ('cat_sys_1', 'project', 'viewer', 'relation'),
    ('cat_sys_1', 'project', 'editor', 'relation'),
    ('cat_sys_1', 'project', 'admin', 'relation');
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES
    ('cat_sys_1', 'team', 'member', 'user', '', 0, '', 0),
    ('cat_sys_1', 'project', 'team', 'team', '', 0, '', 0),
    ('cat_sys_1', 'project', 'viewer', 'team', 'member', 0, '', 0),
    ('cat_sys_1', 'project', 'viewer', 'user', '', 0, '', 1),
    ('cat_sys_1', 'project', 'admin', 'user', '', 0, '', 0);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_expression_edges (
    catalog_id, object_type, relation, kind,
    source_object_type, source_relation,
    tupleset_object_type, tupleset_relation, position
) VALUES
    ('cat_sys_1', 'team', 'member', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'team', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'viewer', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'viewer', 'tuple_to_userset', 'team', 'member', 'project', 'team', 1),
    ('cat_sys_1', 'project', 'editor', 'computed_userset', 'project', 'viewer', NULL, NULL, 0),
    ('cat_sys_1', 'project', 'admin', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'admin', 'computed_userset', 'project', 'editor', NULL, NULL, 1);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_relation_closure (
    catalog_id, from_object_type, from_relation, to_object_type, to_relation, depth
) VALUES
    ('cat_sys_1', 'team', 'member', 'team', 'member', 0),
    ('cat_sys_1', 'project', 'team', 'project', 'team', 0),
    ('cat_sys_1', 'project', 'viewer', 'project', 'viewer', 0),
    ('cat_sys_1', 'project', 'viewer', 'project', 'editor', 1),
    ('cat_sys_1', 'project', 'viewer', 'project', 'admin', 2),
    ('cat_sys_1', 'project', 'editor', 'project', 'editor', 0),
    ('cat_sys_1', 'project', 'editor', 'project', 'admin', 1),
    ('cat_sys_1', 'project', 'admin', 'project', 'admin', 0);
-- +goose StatementEnd

-- Backfill resource_scope_index and authz_membership_edges.
-- +goose StatementBegin
INSERT OR IGNORE INTO resource_scope_index (resource_id, resource_kind, project_id, team_id, created_at, updated_at)
SELECT id, 'project', id, NULL,
       CAST(strftime('%s','now') AS INTEGER) * 1000000000,
       CAST(strftime('%s','now') AS INTEGER) * 1000000000
FROM projects;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT OR IGNORE INTO resource_scope_index (resource_id, resource_kind, project_id, team_id, created_at, updated_at)
SELECT id, 'team', project_id, id,
       CAST(strftime('%s','now') AS INTEGER) * 1000000000,
       CAST(strftime('%s','now') AS INTEGER) * 1000000000
FROM teams;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT OR IGNORE INTO resource_scope_index (resource_id, resource_kind, project_id, team_id, created_at, updated_at)
SELECT id, 'user', project_id, NULL,
       CAST(strftime('%s','now') AS INTEGER) * 1000000000,
       CAST(strftime('%s','now') AS INTEGER) * 1000000000
FROM users;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT OR IGNORE INTO authz_membership_edges (project_id, member_type, member_id, set_type, set_id, created_at)
SELECT project_id, 'user', user_id, 'team', team_id,
       CAST(strftime('%s','now') AS INTEGER) * 1000000000
FROM team_memberships
WHERE status = 'active';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_authz_membership_edges_member;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_membership_edges;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS authz_assignments_unique_active;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_authz_assignments_delegation;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_authz_assignments_principal_project;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_assignments;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_bundle_members;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_bundles;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_expression_edges;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_relation_references;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_authz_closure_to;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_relation_closure;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_relations;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS authz_catalogs_one_active;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS authz_catalogs;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_resource_scope_index_kind_project;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_resource_scope_index_project;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS resource_scope_index;
-- +goose StatementEnd
