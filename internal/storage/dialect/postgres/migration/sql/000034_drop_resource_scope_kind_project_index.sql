-- +goose NO TRANSACTION
-- +goose Up
-- idx_resource_scope_index_kind_project is (resource_kind, project_id): the
-- leading two columns of the primary key (resource_kind, project_id,
-- resource_id), in the same collation. The primary key serves every lookup the
-- index could, and the authz list query, which filters on kind and project and
-- orders by resource_id, can read its rows from it already in that order.
--
-- Keeping the index cost upkeep for every row inserted or deleted, and on the
-- hosted cloud the planner picked it for lookups by the full key, reading the
-- rows of that kind in the project to find one.
--
-- CONCURRENTLY, because this table is on the request path: the API resolves
-- calls by id through it, and creating or deleting a resource it tracks writes
-- it. A plain DROP INDEX queues for an ACCESS EXCLUSIVE lock behind any open
-- transaction on the table, and every query after it queues behind the DROP.
-- That is what NO TRANSACTION above is for, as CONCURRENTLY cannot run inside a
-- transaction. IF EXISTS lets a rerun after a failure converge.
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_resource_scope_index_kind_project;

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_resource_scope_index_kind_project;
CREATE INDEX CONCURRENTLY idx_resource_scope_index_kind_project
    ON zitadel_nextgen.resource_scope_index (resource_kind, project_id);
