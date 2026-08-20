-- +goose NO TRANSACTION
-- +goose Up
-- Wave 1 (#422): authz MVP tables aligned to #720 CatalogMutations, seed, backfill.
--
-- Relation identity is (object_type, relation). Expression edges + relation
-- references store compiled policy. Bundle tables exist but are unused by the
-- v1 compiler mapper.
--
-- Spanner has no partial (WHERE) unique indexes. active_guard / active_unique_key
-- are NULL when the row should be excluded from uniqueness; NULL_FILTERED unique
-- indexes then match the Postgres partial-unique semantics.
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
    resource_id   STRING(MAX) NOT NULL,
    resource_kind STRING(MAX) NOT NULL,
    project_id    STRING(MAX) NOT NULL,
    team_id       STRING(MAX),
    created_at    TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at    TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_resource_scope_index_resource_id CHECK (resource_id <> ''),
    CONSTRAINT chk_resource_scope_index_resource_kind CHECK (resource_kind <> ''),
    CONSTRAINT fk_resource_scope_index_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_resource_scope_index_team
        FOREIGN KEY (project_id, team_id) REFERENCES teams (project_id, id) ON DELETE CASCADE
) PRIMARY KEY (resource_kind, project_id, resource_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_resource_scope_index_project
    ON resource_scope_index (project_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_resource_scope_index_kind_project
    ON resource_scope_index (resource_kind, project_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_catalogs (
    id           STRING(MAX) NOT NULL,
    catalog_kind STRING(MAX) NOT NULL,
    owner_id     STRING(MAX) NOT NULL,
    version      INT64 NOT NULL,
    status       STRING(MAX) NOT NULL,
    source_hash  STRING(MAX),
    -- '1' when status='active', NULL otherwise (Spanner stand-in for partial unique).
    active_guard STRING(MAX),
    created_at   TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_authz_catalogs_id CHECK (id <> ''),
    CONSTRAINT chk_authz_catalogs_kind CHECK (catalog_kind = 'system' OR catalog_kind = 'app_group'),
    CONSTRAINT chk_authz_catalogs_version CHECK (version >= 1),
    CONSTRAINT chk_authz_catalogs_status CHECK (status = 'draft' OR status = 'active' OR status = 'retired')
) PRIMARY KEY (id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_authz_catalogs_kind_owner_version
    ON authz_catalogs (catalog_kind, owner_id, version)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX authz_catalogs_one_active
    ON authz_catalogs (catalog_kind, owner_id, active_guard)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_relations (
    catalog_id  STRING(MAX) NOT NULL,
    object_type STRING(MAX) NOT NULL,
    relation    STRING(MAX) NOT NULL,
    kind        STRING(MAX) NOT NULL,
    CONSTRAINT chk_authz_relations_object_type CHECK (object_type <> ''),
    CONSTRAINT chk_authz_relations_relation CHECK (relation <> ''),
    CONSTRAINT chk_authz_relations_kind CHECK (kind = 'permission' OR kind = 'relation'),
    CONSTRAINT fk_authz_relations_catalog
        FOREIGN KEY (catalog_id) REFERENCES authz_catalogs (id) ON DELETE CASCADE
) PRIMARY KEY (catalog_id, object_type, relation)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_relation_closure (
    catalog_id       STRING(MAX) NOT NULL,
    from_object_type STRING(MAX) NOT NULL,
    from_relation    STRING(MAX) NOT NULL,
    to_object_type   STRING(MAX) NOT NULL,
    to_relation      STRING(MAX) NOT NULL,
    depth            INT64 NOT NULL,
    CONSTRAINT chk_authz_relation_closure_depth CHECK (depth >= 0),
    CONSTRAINT fk_authz_closure_catalog
        FOREIGN KEY (catalog_id) REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    CONSTRAINT fk_authz_closure_from
        FOREIGN KEY (catalog_id, from_object_type, from_relation)
        REFERENCES authz_relations (catalog_id, object_type, relation),
    CONSTRAINT fk_authz_closure_to
        FOREIGN KEY (catalog_id, to_object_type, to_relation)
        REFERENCES authz_relations (catalog_id, object_type, relation)
) PRIMARY KEY (catalog_id, from_object_type, from_relation, to_object_type, to_relation)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_authz_closure_to
    ON authz_relation_closure (catalog_id, to_object_type, to_relation)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_relation_references (
    catalog_id   STRING(MAX) NOT NULL,
    object_type  STRING(MAX) NOT NULL,
    relation     STRING(MAX) NOT NULL,
    ref_type     STRING(MAX) NOT NULL,
    ref_relation STRING(MAX) NOT NULL DEFAULT (''),
    wildcard     BOOL NOT NULL DEFAULT (FALSE),
    condition    STRING(MAX) NOT NULL DEFAULT (''),
    position     INT64 NOT NULL,
    CONSTRAINT chk_authz_relation_references_ref_type CHECK (ref_type <> ''),
    CONSTRAINT chk_authz_relation_references_position CHECK (position >= 0),
    CONSTRAINT fk_authz_relation_references_catalog
        FOREIGN KEY (catalog_id) REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    CONSTRAINT fk_authz_relation_references_relation
        FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation) ON DELETE CASCADE
) PRIMARY KEY (catalog_id, object_type, relation, position)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_expression_edges (
    catalog_id           STRING(MAX) NOT NULL,
    object_type          STRING(MAX) NOT NULL,
    relation             STRING(MAX) NOT NULL,
    kind                 STRING(MAX) NOT NULL,
    source_object_type   STRING(MAX),
    source_relation      STRING(MAX),
    tupleset_object_type STRING(MAX),
    tupleset_relation    STRING(MAX),
    position             INT64 NOT NULL,
    CONSTRAINT chk_authz_expression_edges_kind CHECK (
        kind = 'direct' OR kind = 'computed_userset' OR kind = 'tuple_to_userset'
    ),
    CONSTRAINT chk_authz_expression_edges_position CHECK (position >= 0),
    CONSTRAINT fk_authz_expression_edges_catalog
        FOREIGN KEY (catalog_id) REFERENCES authz_catalogs (id) ON DELETE CASCADE,
    CONSTRAINT fk_authz_expression_edges_relation
        FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation) ON DELETE CASCADE
) PRIMARY KEY (catalog_id, object_type, relation, position)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_bundles (
    catalog_id STRING(MAX) NOT NULL,
    bundle     STRING(MAX) NOT NULL,
    CONSTRAINT fk_authz_bundles_catalog
        FOREIGN KEY (catalog_id) REFERENCES authz_catalogs (id) ON DELETE CASCADE
) PRIMARY KEY (catalog_id, bundle)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_bundle_members (
    catalog_id  STRING(MAX) NOT NULL,
    bundle      STRING(MAX) NOT NULL,
    object_type STRING(MAX) NOT NULL,
    relation    STRING(MAX) NOT NULL,
    CONSTRAINT fk_authz_bundle_members_bundle
        FOREIGN KEY (catalog_id, bundle) REFERENCES authz_bundles (catalog_id, bundle) ON DELETE CASCADE,
    CONSTRAINT fk_authz_bundle_members_relation
        FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation)
) PRIMARY KEY (catalog_id, bundle, object_type, relation)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_assignments (
    id                STRING(MAX) NOT NULL,
    project_id        STRING(MAX) NOT NULL,
    catalog_id        STRING(MAX) NOT NULL,
    principal_type    STRING(MAX) NOT NULL,
    principal_id      STRING(MAX) NOT NULL,
    object_type       STRING(MAX) NOT NULL,
    relation          STRING(MAX) NOT NULL,
    scope_kind        STRING(MAX) NOT NULL,
    scope_team_id     STRING(MAX),
    scope_resource_id STRING(MAX),
    grantor_type      STRING(MAX),
    grantor_id        STRING(MAX),
    delegation_id     STRING(MAX),
    expires_at        TIMESTAMP,
    revoked_at        TIMESTAMP,
    -- Concatenated uniqueness key when revoked_at IS NULL AND delegation_id IS NULL; else NULL.
    active_unique_key STRING(MAX),
    -- project_id when this is an active owning-team grant (object 'project',
    -- relation 'team', not revoked); else NULL. ADR 054 §2 one-owner stand-in.
    owning_team_key   STRING(MAX),
    created_at        TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at        TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_authz_assignments_id CHECK (id <> ''),
    CONSTRAINT chk_authz_assignments_object_type CHECK (object_type <> ''),
    CONSTRAINT chk_authz_assignments_relation CHECK (relation <> ''),
    CONSTRAINT chk_authz_assignments_principal_type CHECK (principal_type = 'user' OR principal_type = 'team' OR principal_type = 'agent' OR principal_type = 'sk_proj' OR principal_type = 'sk_team'),
    CONSTRAINT chk_authz_assignments_scope_kind CHECK (scope_kind = 'project' OR scope_kind = 'team' OR scope_kind = 'resource'),
    CONSTRAINT chk_authz_assignments_scope CHECK (
        (scope_kind = 'project' AND scope_team_id IS NULL AND scope_resource_id IS NULL)
        OR (scope_kind = 'team' AND scope_team_id IS NOT NULL AND scope_resource_id IS NULL)
        OR (scope_kind = 'resource' AND scope_resource_id IS NOT NULL)
    ),
    CONSTRAINT chk_authz_assignments_delegation CHECK (
        (delegation_id IS NULL AND grantor_id IS NULL)
        OR (delegation_id IS NOT NULL AND grantor_id IS NOT NULL)
    ),
    CONSTRAINT fk_authz_assignments_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_authz_assignments_catalog
        FOREIGN KEY (catalog_id) REFERENCES authz_catalogs (id) ON DELETE NO ACTION,
    CONSTRAINT fk_authz_assignments_relation
        FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES authz_relations (catalog_id, object_type, relation),
    CONSTRAINT fk_authz_assignments_scope_team
        FOREIGN KEY (project_id, scope_team_id) REFERENCES teams (project_id, id) ON DELETE CASCADE
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_authz_assignments_principal_project
    ON authz_assignments (project_id, principal_type, principal_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE NULL_FILTERED INDEX idx_authz_assignments_delegation
    ON authz_assignments (project_id, delegation_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX authz_assignments_unique_active
    ON authz_assignments (active_unique_key)
-- +goose StatementEnd

-- ADR 054 §2: at most one active owning-team grant per project. The active
-- key above includes the principal, so on its own it lets two teams race into
-- concurrent ownership; this narrows the winner of a claim race to one row.
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX authz_assignments_one_owning_team
    ON authz_assignments (owning_team_key)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE authz_membership_edges (
    project_id  STRING(MAX) NOT NULL,
    member_type STRING(MAX) NOT NULL,
    member_id   STRING(MAX) NOT NULL,
    set_type    STRING(MAX) NOT NULL,
    set_id      STRING(MAX) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_authz_membership_edges_mvp
        CHECK (member_type = 'user' AND set_type = 'team'),
    CONSTRAINT fk_authz_membership_edges_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_authz_membership_edges_set
        FOREIGN KEY (project_id, set_id) REFERENCES teams (project_id, id) ON DELETE CASCADE
) PRIMARY KEY (project_id, set_type, set_id, member_type, member_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_authz_membership_edges_member
    ON authz_membership_edges (project_id, member_type, member_id)
-- +goose StatementEnd

-- System catalog seed (must match domain.SystemCatalogID).
-- +goose StatementBegin
INSERT INTO authz_catalogs (id, catalog_kind, owner_id, version, status, active_guard)
VALUES ('cat_sys_1', 'system', 'system', 1, 'active', '1')
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_relations (catalog_id, object_type, relation, kind) VALUES
    ('cat_sys_1', 'team', 'member', 'relation'),
    ('cat_sys_1', 'project', 'team', 'relation'),
    ('cat_sys_1', 'project', 'viewer', 'relation'),
    ('cat_sys_1', 'project', 'editor', 'relation'),
    ('cat_sys_1', 'project', 'admin', 'relation')
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES
    ('cat_sys_1', 'team', 'member', 'user', '', FALSE, '', 0),
    ('cat_sys_1', 'project', 'team', 'team', '', FALSE, '', 0),
    ('cat_sys_1', 'project', 'viewer', 'team', 'member', FALSE, '', 0),
    ('cat_sys_1', 'project', 'viewer', 'user', '', FALSE, '', 1),
    ('cat_sys_1', 'project', 'admin', 'user', '', FALSE, '', 0)
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
    ('cat_sys_1', 'project', 'admin', 'computed_userset', 'project', 'editor', NULL, NULL, 1)
-- +goose StatementEnd

-- Reflexive + computed-userset closure (viewer -> editor -> admin).
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
    ('cat_sys_1', 'project', 'admin', 'project', 'admin', 0)
-- +goose StatementEnd

-- Backfill
-- +goose StatementBegin
INSERT OR IGNORE INTO resource_scope_index (resource_id, resource_kind, project_id, team_id)
SELECT id, 'project', id, NULL
FROM projects
-- +goose StatementEnd

-- +goose StatementBegin
INSERT OR IGNORE INTO resource_scope_index (resource_id, resource_kind, project_id, team_id)
SELECT id, 'team', project_id, id
FROM teams
-- +goose StatementEnd

-- +goose StatementBegin
INSERT OR IGNORE INTO resource_scope_index (resource_id, resource_kind, project_id, team_id)
SELECT id, 'user', project_id, NULL
FROM users
-- +goose StatementEnd

-- +goose StatementBegin
INSERT OR IGNORE INTO authz_membership_edges (project_id, member_type, member_id, set_type, set_id)
SELECT project_id, 'user', user_id, 'team', team_id
FROM team_memberships
WHERE status = 'active'
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX idx_authz_membership_edges_member
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_membership_edges
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX authz_assignments_one_owning_team
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX authz_assignments_unique_active
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_authz_assignments_delegation
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_authz_assignments_principal_project
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_assignments
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_bundle_members
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_bundles
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_expression_edges
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_relation_references
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_authz_closure_to
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_relation_closure
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_relations
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX authz_catalogs_one_active
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX uq_authz_catalogs_kind_owner_version
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE authz_catalogs
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_resource_scope_index_kind_project
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_resource_scope_index_project
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE resource_scope_index
-- +goose StatementEnd
