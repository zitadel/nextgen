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

CREATE TABLE zitadel_nextgen.resource_scope_index (
    resource_id   TEXT COLLATE "C" NOT NULL CHECK (resource_id <> ''),
    resource_kind TEXT COLLATE "C" NOT NULL CHECK (resource_kind <> ''),
    project_id    TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE,
    team_id       TEXT COLLATE "C",
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (resource_kind, project_id, resource_id),
    FOREIGN KEY (project_id, team_id)
        REFERENCES zitadel_nextgen.teams (project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_resource_scope_index_project
    ON zitadel_nextgen.resource_scope_index (project_id);

CREATE INDEX idx_resource_scope_index_kind_project
    ON zitadel_nextgen.resource_scope_index (resource_kind, project_id);

CREATE TABLE zitadel_nextgen.authz_catalogs (
    id           TEXT COLLATE "C" NOT NULL CHECK (id <> ''),
    catalog_kind TEXT COLLATE "C" NOT NULL
        CHECK (catalog_kind IN ('system', 'app_group')),
    owner_id     TEXT COLLATE "C" NOT NULL,
    version      INT  NOT NULL CHECK (version >= 1),
    status       TEXT COLLATE "C" NOT NULL
        CHECK (status IN ('draft', 'active', 'retired')),
    source_hash  TEXT COLLATE "C",
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    UNIQUE (catalog_kind, owner_id, version)
);

CREATE UNIQUE INDEX authz_catalogs_one_active
    ON zitadel_nextgen.authz_catalogs (catalog_kind, owner_id)
    WHERE status = 'active';

CREATE TABLE zitadel_nextgen.authz_relations (
    catalog_id  TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.authz_catalogs (id) ON DELETE CASCADE,
    object_type TEXT COLLATE "C" NOT NULL CHECK (object_type <> ''),
    relation    TEXT COLLATE "C" NOT NULL CHECK (relation <> ''),
    kind        TEXT COLLATE "C" NOT NULL
        CHECK (kind IN ('permission', 'relation')),
    PRIMARY KEY (catalog_id, object_type, relation)
);

CREATE TABLE zitadel_nextgen.authz_relation_closure (
    catalog_id       TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.authz_catalogs (id) ON DELETE CASCADE,
    from_object_type TEXT COLLATE "C" NOT NULL,
    from_relation    TEXT COLLATE "C" NOT NULL,
    to_object_type   TEXT COLLATE "C" NOT NULL,
    to_relation      TEXT COLLATE "C" NOT NULL,
    depth            INT  NOT NULL CHECK (depth >= 0),
    PRIMARY KEY (catalog_id, from_object_type, from_relation, to_object_type, to_relation),
    FOREIGN KEY (catalog_id, from_object_type, from_relation)
        REFERENCES zitadel_nextgen.authz_relations (catalog_id, object_type, relation),
    FOREIGN KEY (catalog_id, to_object_type, to_relation)
        REFERENCES zitadel_nextgen.authz_relations (catalog_id, object_type, relation)
);

CREATE INDEX idx_authz_closure_to
    ON zitadel_nextgen.authz_relation_closure (catalog_id, to_object_type, to_relation);

CREATE TABLE zitadel_nextgen.authz_relation_references (
    catalog_id   TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.authz_catalogs (id) ON DELETE CASCADE,
    object_type  TEXT COLLATE "C" NOT NULL,
    relation     TEXT COLLATE "C" NOT NULL,
    ref_type     TEXT COLLATE "C" NOT NULL CHECK (ref_type <> ''),
    ref_relation TEXT COLLATE "C" NOT NULL DEFAULT '',
    wildcard     BOOLEAN NOT NULL DEFAULT FALSE,
    condition    TEXT COLLATE "C" NOT NULL DEFAULT '',
    position     INT  NOT NULL CHECK (position >= 0),
    PRIMARY KEY (catalog_id, object_type, relation, position),
    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES zitadel_nextgen.authz_relations (catalog_id, object_type, relation)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.authz_expression_edges (
    catalog_id            TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.authz_catalogs (id) ON DELETE CASCADE,
    object_type           TEXT COLLATE "C" NOT NULL,
    relation              TEXT COLLATE "C" NOT NULL,
    kind                  TEXT COLLATE "C" NOT NULL
        CHECK (kind IN ('direct', 'computed_userset', 'tuple_to_userset')),
    source_object_type    TEXT COLLATE "C",
    source_relation       TEXT COLLATE "C",
    tupleset_object_type  TEXT COLLATE "C",
    tupleset_relation     TEXT COLLATE "C",
    position              INT  NOT NULL CHECK (position >= 0),
    PRIMARY KEY (catalog_id, object_type, relation, position),
    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES zitadel_nextgen.authz_relations (catalog_id, object_type, relation)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.authz_bundles (
    catalog_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.authz_catalogs (id) ON DELETE CASCADE,
    bundle     TEXT COLLATE "C" NOT NULL,
    PRIMARY KEY (catalog_id, bundle)
);

CREATE TABLE zitadel_nextgen.authz_bundle_members (
    catalog_id  TEXT COLLATE "C" NOT NULL,
    bundle      TEXT COLLATE "C" NOT NULL,
    object_type TEXT COLLATE "C" NOT NULL,
    relation    TEXT COLLATE "C" NOT NULL,
    PRIMARY KEY (catalog_id, bundle, object_type, relation),
    FOREIGN KEY (catalog_id, bundle)
        REFERENCES zitadel_nextgen.authz_bundles (catalog_id, bundle)
        ON DELETE CASCADE,
    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES zitadel_nextgen.authz_relations (catalog_id, object_type, relation)
);

CREATE TABLE zitadel_nextgen.authz_assignments (
    id                TEXT COLLATE "C" NOT NULL CHECK (id <> ''),
    project_id        TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE,
    catalog_id        TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.authz_catalogs (id) ON DELETE RESTRICT,

    principal_type    TEXT COLLATE "C" NOT NULL
        CHECK (principal_type IN (
            'user', 'team', 'agent', 'sk_proj', 'sk_team'
        )),
    principal_id      TEXT COLLATE "C" NOT NULL,

    object_type       TEXT COLLATE "C" NOT NULL CHECK (object_type <> ''),
    relation          TEXT COLLATE "C" NOT NULL CHECK (relation <> ''),

    scope_kind        TEXT COLLATE "C" NOT NULL
        CHECK (scope_kind IN ('project', 'team', 'resource')),
    scope_team_id     TEXT COLLATE "C",
    scope_resource_id TEXT COLLATE "C",

    grantor_type      TEXT COLLATE "C",
    grantor_id        TEXT COLLATE "C",
    delegation_id     TEXT COLLATE "C",
    expires_at        TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (project_id, id),

    FOREIGN KEY (catalog_id, object_type, relation)
        REFERENCES zitadel_nextgen.authz_relations (catalog_id, object_type, relation),
    FOREIGN KEY (project_id, scope_team_id)
        REFERENCES zitadel_nextgen.teams (project_id, id)
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

CREATE INDEX idx_authz_assignments_principal_project
    ON zitadel_nextgen.authz_assignments
        (project_id, principal_type, principal_id)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_authz_assignments_delegation
    ON zitadel_nextgen.authz_assignments (project_id, delegation_id)
    WHERE delegation_id IS NOT NULL;

-- COALESCE so NULL scope columns participate in uniqueness (PG NULL ≠ NULL).
CREATE UNIQUE INDEX authz_assignments_unique_active
    ON zitadel_nextgen.authz_assignments (
        project_id, catalog_id, principal_type, principal_id,
        object_type, relation, scope_kind,
        (COALESCE(scope_team_id, '')),
        (COALESCE(scope_resource_id, ''))
    )
    WHERE revoked_at IS NULL AND delegation_id IS NULL;

-- ADR 054 §2: at most one active owning-team grant per project. The active
-- key above includes the principal, so on its own it lets two teams race into
-- concurrent ownership; this narrows the winner of a claim race to one row.
CREATE UNIQUE INDEX authz_assignments_one_owning_team
    ON zitadel_nextgen.authz_assignments (project_id)
    WHERE object_type = 'project' AND relation = 'team' AND revoked_at IS NULL;

CREATE TABLE zitadel_nextgen.authz_membership_edges (
    project_id  TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE,
    member_type TEXT COLLATE "C" NOT NULL,
    member_id   TEXT COLLATE "C" NOT NULL,
    set_type    TEXT COLLATE "C" NOT NULL,
    set_id      TEXT COLLATE "C" NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (project_id, set_type, set_id, member_type, member_id),
    CHECK (member_type = 'user' AND set_type = 'team'),
    FOREIGN KEY (project_id, set_id)
        REFERENCES zitadel_nextgen.teams (project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_authz_membership_edges_member
    ON zitadel_nextgen.authz_membership_edges
        (project_id, member_type, member_id);

-- System catalog seed (must match domain.SystemCatalogID).
INSERT INTO zitadel_nextgen.authz_catalogs (id, catalog_kind, owner_id, version, status)
VALUES ('cat_sys_1', 'system', 'system', 1, 'active');

INSERT INTO zitadel_nextgen.authz_relations (catalog_id, object_type, relation, kind) VALUES
    ('cat_sys_1', 'team', 'member', 'relation'),
    ('cat_sys_1', 'project', 'team', 'relation'),
    ('cat_sys_1', 'project', 'viewer', 'relation'),
    ('cat_sys_1', 'project', 'editor', 'relation'),
    ('cat_sys_1', 'project', 'admin', 'relation');

INSERT INTO zitadel_nextgen.authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES
    ('cat_sys_1', 'team', 'member', 'user', '', FALSE, '', 0),
    ('cat_sys_1', 'project', 'team', 'team', '', FALSE, '', 0),
    ('cat_sys_1', 'project', 'viewer', 'team', 'member', FALSE, '', 0),
    ('cat_sys_1', 'project', 'viewer', 'user', '', FALSE, '', 1),
    ('cat_sys_1', 'project', 'admin', 'user', '', FALSE, '', 0);

INSERT INTO zitadel_nextgen.authz_expression_edges (
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

-- Reflexive + computed-userset closure (viewer -> editor -> admin).
INSERT INTO zitadel_nextgen.authz_relation_closure (
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

-- Backfill resource_scope_index and authz_membership_edges.
INSERT INTO zitadel_nextgen.resource_scope_index (resource_id, resource_kind, project_id, team_id)
SELECT id, 'project', id, NULL
FROM zitadel_nextgen.projects
ON CONFLICT (resource_kind, project_id, resource_id) DO NOTHING;

INSERT INTO zitadel_nextgen.resource_scope_index (resource_id, resource_kind, project_id, team_id)
SELECT id, 'team', project_id, id
FROM zitadel_nextgen.teams
ON CONFLICT (resource_kind, project_id, resource_id) DO NOTHING;

INSERT INTO zitadel_nextgen.resource_scope_index (resource_id, resource_kind, project_id, team_id)
SELECT id, 'user', project_id, NULL
FROM zitadel_nextgen.users
ON CONFLICT (resource_kind, project_id, resource_id) DO NOTHING;

INSERT INTO zitadel_nextgen.authz_membership_edges (project_id, member_type, member_id, set_type, set_id)
SELECT project_id, 'user', user_id, 'team', team_id
FROM zitadel_nextgen.team_memberships
WHERE status = 'active'
ON CONFLICT DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.authz_membership_edges;
DROP INDEX IF EXISTS zitadel_nextgen.authz_assignments_one_owning_team;
DROP INDEX IF EXISTS zitadel_nextgen.authz_assignments_unique_active;
DROP INDEX IF EXISTS zitadel_nextgen.idx_authz_assignments_delegation;
DROP INDEX IF EXISTS zitadel_nextgen.idx_authz_assignments_principal_project;
DROP TABLE IF EXISTS zitadel_nextgen.authz_assignments;
DROP TABLE IF EXISTS zitadel_nextgen.authz_bundle_members;
DROP TABLE IF EXISTS zitadel_nextgen.authz_bundles;
DROP TABLE IF EXISTS zitadel_nextgen.authz_expression_edges;
DROP TABLE IF EXISTS zitadel_nextgen.authz_relation_references;
DROP INDEX IF EXISTS zitadel_nextgen.idx_authz_closure_to;
DROP TABLE IF EXISTS zitadel_nextgen.authz_relation_closure;
DROP TABLE IF EXISTS zitadel_nextgen.authz_relations;
DROP INDEX IF EXISTS zitadel_nextgen.authz_catalogs_one_active;
DROP TABLE IF EXISTS zitadel_nextgen.authz_catalogs;
DROP INDEX IF EXISTS zitadel_nextgen.idx_resource_scope_index_kind_project;
DROP INDEX IF EXISTS zitadel_nextgen.idx_resource_scope_index_project;
DROP TABLE IF EXISTS zitadel_nextgen.resource_scope_index;
