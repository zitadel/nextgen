-- +goose NO TRANSACTION
-- +goose Up
-- The user an event concerns, whoever acted: the user a session, a token, a
-- sign-in check or a credential belongs to, and the user a change was made to
-- (ADR 048, amendment of 2026-11-11). NULL on an event that concerns no user.
-- GET /events reads it as user_id.
--
-- A nullable column without a default changes only the catalog, so the ALTER
-- holds its lock for a moment and rewrites nothing. The events already stored
-- are not filled in: they age out of retention, and a list by user matches
-- the events written from here on.
ALTER TABLE zitadel_nextgen.events
    ADD COLUMN IF NOT EXISTS user_id TEXT;

-- CONCURRENTLY and the DROP before the CREATE are as in 000040: events takes
-- a row per API request, so a build must not block its inserts, and a rerun
-- after a failed build must converge.

-- What happened to one user's account, by category, for the reason the
-- actor's index holds the category (000041): a user's sign-ins are a range
-- apart from the changes made to that user. An API request concerns no user,
-- so this leaves most rows out.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_user_category;
CREATE INDEX CONCURRENTLY idx_events_project_user_category
    ON zitadel_nextgen.events (project_id, user_id, category, created_at, id)
    WHERE user_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_user_category;
ALTER TABLE zitadel_nextgen.events
    DROP COLUMN IF EXISTS user_id;
