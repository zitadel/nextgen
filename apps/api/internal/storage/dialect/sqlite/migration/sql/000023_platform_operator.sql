-- +goose Up
-- ADR 075: the deployment-wide platform operator; see the postgres migration
-- for the model these rows add to cat_sys_1.
-- +goose StatementBegin
INSERT INTO authz_relations (catalog_id, object_type, relation, kind) VALUES
    ('cat_sys_1', 'platform', 'operator', 'relation'),
    ('cat_sys_1', 'project', 'platform', 'relation');
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_relation_references (
    catalog_id, object_type, relation, ref_type, ref_relation, wildcard, condition, position
) VALUES
    ('cat_sys_1', 'platform', 'operator', 'user', '', 0, '', 0),
    ('cat_sys_1', 'project', 'platform', 'platform', '', 0, '', 0);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_expression_edges (
    catalog_id, object_type, relation, kind,
    source_object_type, source_relation,
    tupleset_object_type, tupleset_relation, position
) VALUES
    ('cat_sys_1', 'platform', 'operator', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'platform', 'direct', NULL, NULL, NULL, NULL, 0),
    ('cat_sys_1', 'project', 'admin', 'tuple_to_userset', 'platform', 'operator', 'project', 'platform', 2);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO authz_relation_closure (
    catalog_id, from_object_type, from_relation, to_object_type, to_relation, depth
) VALUES
    ('cat_sys_1', 'platform', 'operator', 'platform', 'operator', 0),
    ('cat_sys_1', 'project', 'platform', 'project', 'platform', 0);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM authz_assignments
WHERE catalog_id = 'cat_sys_1' AND object_type = 'platform';
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM authz_relation_closure
WHERE catalog_id = 'cat_sys_1'
  AND ((from_object_type = 'platform' AND from_relation = 'operator')
       OR (from_object_type = 'project' AND from_relation = 'platform'));
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM authz_expression_edges
WHERE catalog_id = 'cat_sys_1'
  AND ((object_type = 'platform' AND relation = 'operator')
       OR (object_type = 'project' AND relation = 'platform')
       OR (object_type = 'project' AND relation = 'admin' AND source_object_type = 'platform'));
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM authz_relation_references
WHERE catalog_id = 'cat_sys_1'
  AND ((object_type = 'platform' AND relation = 'operator')
       OR (object_type = 'project' AND relation = 'platform'));
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM authz_relations
WHERE catalog_id = 'cat_sys_1'
  AND ((object_type = 'platform' AND relation = 'operator')
       OR (object_type = 'project' AND relation = 'platform'));
-- +goose StatementEnd
