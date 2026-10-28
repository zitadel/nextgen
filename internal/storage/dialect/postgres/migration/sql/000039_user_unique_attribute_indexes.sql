-- +goose NO TRANSACTION
-- +goose Up
-- user_unique_attributes and tokens reference users (project_id, id) with
-- ON DELETE CASCADE, but neither had an index containing user_id, and the
-- registry had none serving a lookup without a team scope. Measured with 100k
-- users in one project, Postgres 18 and SQLite 3.51:
--
--   unique attribute lookup, correlated EXISTS, no index: 0.1 ms / > 100 s
--   correlated IN + idx_user_unique_attributes_lookup:     0.04 ms / 0.0 ms
--   delete one user, no user-led index:                    4.1 ms / 7 ms
--   delete one user + idx_user_unique_attributes_user:     0.2 ms / 1 ms
--
-- CONCURRENTLY, as in 000019, so no build blocks user creation or token
-- writes. Postgres refuses CONCURRENTLY on the partitioned registry, so each
-- registry index is created invalid ON ONLY the parent, built concurrently on
-- each partition, and attached; the parent turns valid with the last attach.
-- The partition names and count come from 000004_users.sql (hash modulus 2).
-- A failed build leaves an INVALID index, so each group starts with drops:
-- dropping the parent removes attached children, the child drops remove an
-- unattached leftover.

-- Serves the lookup without a team scope. With a team scope the primary key
-- already seeks.
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_lookup;
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_lookup_part_0;
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_lookup_part_1;
CREATE INDEX idx_user_unique_attributes_lookup
    ON ONLY zitadel_nextgen.user_unique_attributes (project_id, key, value_hash)
    INCLUDE (user_id);
CREATE INDEX CONCURRENTLY idx_user_unique_attributes_lookup_part_0
    ON zitadel_nextgen.user_unique_attributes_part_0 (project_id, key, value_hash)
    INCLUDE (user_id);
CREATE INDEX CONCURRENTLY idx_user_unique_attributes_lookup_part_1
    ON zitadel_nextgen.user_unique_attributes_part_1 (project_id, key, value_hash)
    INCLUDE (user_id);
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_lookup
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_lookup_part_0;
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_lookup
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_lookup_part_1;

-- Serves the cascade from users.
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_user;
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_user_part_0;
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_user_part_1;
CREATE INDEX idx_user_unique_attributes_user
    ON ONLY zitadel_nextgen.user_unique_attributes (project_id, user_id);
CREATE INDEX CONCURRENTLY idx_user_unique_attributes_user_part_0
    ON zitadel_nextgen.user_unique_attributes_part_0 (project_id, user_id);
CREATE INDEX CONCURRENTLY idx_user_unique_attributes_user_part_1
    ON zitadel_nextgen.user_unique_attributes_part_1 (project_id, user_id);
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_user
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_user_part_0;
ALTER INDEX zitadel_nextgen.idx_user_unique_attributes_user
    ATTACH PARTITION zitadel_nextgen.idx_user_unique_attributes_user_part_1;

-- Serves the cascade from users.
DROP INDEX IF EXISTS zitadel_nextgen.idx_tokens_user;
CREATE INDEX CONCURRENTLY idx_tokens_user
    ON zitadel_nextgen.tokens (project_id, user_id);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_tokens_user;
-- CONCURRENTLY is refused on a partitioned index.
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_user;
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_unique_attributes_lookup;
