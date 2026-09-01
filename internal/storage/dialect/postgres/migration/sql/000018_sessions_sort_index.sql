-- +goose Up
-- ListSessions had no index to work with: sessions carried only the primary key
-- (project_id, id) and the partial unique index on token_id, so every page of
-- POST /sessions/query scanned and sorted a project's whole session table before
-- applying LIMIT. Measured on 2M sessions: 130ms for an unfiltered first page.
--
-- Both indexes are needed, and they cover opposite selectivities of the team
-- filter (ADR 059). With only the sort index, a team owning a handful of a busy
-- project's users walks most of the table before finding 20 matching rows —
-- measurably worse than no index at all (1158ms vs 141ms on 2M sessions).

-- Serves the default ORDER BY created_at DESC, id DESC and its ASC form: a
-- btree scans backward, so one definition covers both directions.
CREATE INDEX idx_sessions_created_at
    ON zitadel_nextgen.sessions (project_id, created_at, id);

-- Lets a selective team filter drive from users into sessions instead of
-- scanning sessions and probing the owning team per row. The users side is
-- already covered by idx_users_lifecycle_owner_team_id (000011).
CREATE INDEX idx_sessions_user
    ON zitadel_nextgen.sessions (project_id, user_id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_sessions_user;
DROP INDEX IF EXISTS zitadel_nextgen.idx_sessions_created_at;
