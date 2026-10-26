-- +goose NO TRANSACTION
-- +goose Up
-- Serves the users-on-a-schema lookups: the schema filter on POST /users/query
-- and the in_use flag on GET /schemas, which asks once per listed revision
-- whether any user is on it. Without it both read every user of the project.
--
-- users is on the request path, and a plain CREATE INDEX blocks its writes
-- until the build finishes. A partitioned table cannot be indexed
-- CONCURRENTLY, so the parent index is created ON ONLY the parent, which is
-- instant and leaves it invalid, the partition's index is built CONCURRENTLY,
-- and attaching it makes the parent valid. NO TRANSACTION above is for the
-- CONCURRENTLY build.
--
-- A failed or cancelled build leaves an INVALID partition index behind, so the
-- build is preceded by a DROP, as in 000019: a rerun rebuilds it instead of
-- keeping the leftover, which attaching would not repair. The attach is the
-- last step, so a failure always leaves the partition index unattached.
CREATE INDEX IF NOT EXISTS idx_users_schema_url
    ON ONLY zitadel_nextgen.users (project_id, schema_url);

DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_users_part_0_schema_url;
CREATE INDEX CONCURRENTLY idx_users_part_0_schema_url
    ON zitadel_nextgen.users_part_0 (project_id, schema_url);

ALTER INDEX zitadel_nextgen.idx_users_schema_url
    ATTACH PARTITION zitadel_nextgen.idx_users_part_0_schema_url;

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_users_schema_url;
