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
-- A rerun must converge wherever the last run stopped. A failed or cancelled
-- build leaves an INVALID partition index behind, which attaching would not
-- repair, so an unattached leftover is dropped, as in 000019, and rebuilt. An
-- attached one is complete and Postgres refuses to drop it, so it is kept, and
-- attaching it again is a no-op.
CREATE INDEX IF NOT EXISTS idx_users_schema_url
    ON ONLY zitadel_nextgen.users (project_id, schema_url);

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = to_regclass('zitadel_nextgen.idx_users_part_0_schema_url')
          AND relispartition
    ) THEN
        DROP INDEX IF EXISTS zitadel_nextgen.idx_users_part_0_schema_url;
    END IF;
END
$$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_part_0_schema_url
    ON zitadel_nextgen.users_part_0 (project_id, schema_url);

ALTER INDEX zitadel_nextgen.idx_users_schema_url
    ATTACH PARTITION zitadel_nextgen.idx_users_part_0_schema_url;

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_users_schema_url;
