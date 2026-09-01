-- +goose NO TRANSACTION
-- +goose Up
-- ListSessions had no index to work with: sessions carried only the primary key
-- (project_id, id) and the partial unique index on token_id, so every page of
-- POST /sessions/query scanned and sorted a project's whole session table before
-- applying LIMIT. Measured on 2M sessions: 127ms for an unfiltered first page,
-- against 0.44ms with these indexes in place.
--
-- Both indexes are needed, and they cover opposite selectivities of the team
-- filter (ADR 060). With only the sort index, a team owning a handful of a busy
-- project's users walks most of the table before finding 20 matching rows —
-- measurably worse than no index at all (116ms vs 111ms on 2M sessions, against
-- 0.47ms with both).
--
-- CONCURRENTLY, because sessions is a hot write path: a plain CREATE INDEX
-- holds a SHARE lock for the whole build, which blocks session creation and
-- exchange. That is what NO TRANSACTION above is for — goose wraps a migration
-- in a transaction by default, and CONCURRENTLY cannot run inside one. It costs
-- a second table pass, and a failed build leaves an INVALID index behind, so
-- each CREATE is preceded by a DROP: a rerun after a failure then converges
-- instead of colliding with the leftover.

-- Serves the default ORDER BY created_at DESC, id DESC and its ASC form: a
-- btree scans backward, so one definition covers both directions.
DROP INDEX IF EXISTS zitadel_nextgen.idx_sessions_created_at;
CREATE INDEX CONCURRENTLY idx_sessions_created_at
    ON zitadel_nextgen.sessions (project_id, created_at, id);

-- Lets a selective team filter drive from users into sessions instead of
-- scanning sessions and probing the owning team per row. The users side is
-- already covered by idx_users_lifecycle_owner_team_id (000011).
DROP INDEX IF EXISTS zitadel_nextgen.idx_sessions_user;
CREATE INDEX CONCURRENTLY idx_sessions_user
    ON zitadel_nextgen.sessions (project_id, user_id);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_sessions_user;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_sessions_created_at;
