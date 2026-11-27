-- +goose Up
-- ADR 075: the deployment-wide platform operator. Extends cat_sys_1 with:
--   type platform
--     relations
--       define operator: [user]
--   type project
--     relations
--       define platform: [platform]
--       define admin: [user, team#member] or member from team or operator from platform
--
-- project.platform holds no rows: every project belongs to the deployment's one
-- platform object, so the resolver reads that tupleset as implied. The rows are
-- additive; no existing relation's closure changes.
INSERT INTO zitadel_nextgen.authz_relations (catalog_id, object_type, relation, kind) VALUES
    ('cat_sys_1', 'platform', 'operator', 'relation'),
    ('cat_sys_1', 'project', 'platform', 'relation');

INSERT INTO zitadel_nextgen.authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES
    ('cat_sys_1', 'platform', 'operator', 'user', '', FALSE, '', 0),
    ('cat_sys_1', 'project', 'platform', 'platform', '', FALSE, '', 0);

INSERT INTO zitadel_nextgen.authz_expression_edges (
    catalog_id, object_type, relation, kind,
    source_object_type, source_relation,
    tupleset_object_type, tupleset_relation, position
) VALUES
    ('cat_sys_1', 'platform', 'operator', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'platform', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'admin', 'tuple_to_userset', 'platform', 'operator', 'project', 'platform', 2);

INSERT INTO zitadel_nextgen.authz_relation_closure (
    catalog_id, from_object_type, from_relation, to_object_type, to_relation, depth
) VALUES
    ('cat_sys_1', 'platform', 'operator', 'platform', 'operator', 0),
    ('cat_sys_1', 'project', 'platform', 'project', 'platform', 0);

-- +goose Down
DELETE FROM zitadel_nextgen.authz_assignments
WHERE catalog_id = 'cat_sys_1' AND object_type = 'platform';

DELETE FROM zitadel_nextgen.authz_relation_closure
WHERE catalog_id = 'cat_sys_1'
  AND (from_object_type, from_relation) IN (('platform', 'operator'), ('project', 'platform'));

DELETE FROM zitadel_nextgen.authz_expression_edges
WHERE catalog_id = 'cat_sys_1'
  AND (
      (object_type, relation) IN (('platform', 'operator'), ('project', 'platform'))
      OR (object_type = 'project' AND relation = 'admin' AND source_object_type = 'platform')
  );

DELETE FROM zitadel_nextgen.authz_relation_references
WHERE catalog_id = 'cat_sys_1'
  AND (object_type, relation) IN (('platform', 'operator'), ('project', 'platform'));

DELETE FROM zitadel_nextgen.authz_relations
WHERE catalog_id = 'cat_sys_1'
  AND (object_type, relation) IN (('platform', 'operator'), ('project', 'platform'));
