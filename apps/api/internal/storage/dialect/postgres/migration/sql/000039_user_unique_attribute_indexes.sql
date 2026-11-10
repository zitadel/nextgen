-- +goose NO TRANSACTION
-- +goose Up
-- user_unique_attributes and tokens reference users (project_id, id) with
-- ON DELETE CASCADE, but neither had an index containing user_id, and the
-- registry had none serving a lookup without a team scope. Measured with 100k
-- users in one project, Postgres 18 and SQLite 3.51:
--
--   unique attribute lookup, correlated EXISTS, no index:     0.1 ms / > 100 s
--   registry-first join + idx_user_unique_attributes_lookup:  0.03 ms / < 0.1 ms
--   delete one user, no user-led index:                       4.1 ms / 7 ms
--   delete one user + idx_user_unique_attributes_user:        0.2 ms / 1 ms
--
-- CONCURRENTLY, as in 000019, so no build blocks user creation or token
-- writes. Postgres refuses CONCURRENTLY on the partitioned registry, so each
-- registry index is created invalid ON ONLY the parent, built concurrently on
-- each partition, and attached; the parent turns valid with the last attach.
-- The partition names and count come from 000004_users.sql (hash modulus 2).
--
-- A rerun must converge wherever the last run stopped, as in 000038. A failed
-- or cancelled build leaves an INVALID index behind, so an unattached
-- partition index or an invalid tokens index is dropped and rebuilt. An
-- attached partition index or a valid tokens index is complete and kept.

-- Serves the lookup without a team scope. With a team scope the primary key
-- already seeks.
CREATE INDEX IF NOT EXISTS idx_user_unique_attributes_lookup
    ON ONLY zitadel_nextgen.user_unique_attributes (project_id, key, value_hash);

-- Serves the cascade from users.
CREATE INDEX IF NOT EXISTS idx_user_unique_attributes_user
    ON ONLY zitadel_nextgen.user_unique_attributes (project_id, user_id);

-- +goose StatementBegin
DO $$
DECLARE
    leftover text;
BEGIN
    FOREACH leftover IN ARRAY ARRAY[
        'zitadel_nextgen.idx_user_unique_attributes_lookup_part_0',
        'zitadel_nextgen.idx_user_unique_attributes_lookup_part_1',
        'zitadel_nextgen.idx_user_unique_attributes_user_part_0',
        'zitadel_nextgen.idx_user_unique_attributes_user_part_1'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_class
            WHERE oid = to_regclass(leftover)
              AND relispartition
        ) THEN
            EXECUTE 'DROP INDEX IF EXISTS ' || leftover;
        END IF;
    END LOOP;
    IF EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass('zitadel_nextgen.idx_tokens_user')
          AND NOT indisvalid
    ) THEN
        DROP INDEX zitadel_nextgen.idx_tokens_user;
    END IF;
END
$$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_unique_attributes_lookup_part_0
    ON zitadel_nextgen.user_unique_attributes_part_0 (project_id, key, value_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_unique_attributes_lookup_part_1
    ON zitadel_nextgen.user_unique_attributes_part_1 (project_id, key, value_hash);
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_lookup
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_lookup_part_0;
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_lookup
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_lookup_part_1;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_unique_attributes_user_part_0
    ON zitadel_nextgen.user_unique_attributes_part_0 (project_id, user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_unique_attributes_user_part_1
    ON zitadel_nextgen.user_unique_attributes_part_1 (project_id, user_id);
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_user
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_user_part_0;
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_user
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_user_part_1;

-- Serves the cascade from users. Partial: every session starts with an
-- anonymous token whose user_id is NULL, and the cascade never looks for one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_user
    ON zitadel_nextgen.tokens (project_id, user_id)
    WHERE user_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_tokens_user;
-- CONCURRENTLY is refused on a partitioned index.
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_user;
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_lookup;
