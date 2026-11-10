-- +goose NO TRANSACTION
-- +goose Up
-- Three more reads of GET /events get an index, after the four in 000040:
-- the events of one type, of one actor and on one resource (ADR 048, amendment
-- of 2026-11-10). They are a migration of their own because 000040 had already
-- run on databases that followed its branch.
--
-- CONCURRENTLY and the DROP before each CREATE are as in 000040: events takes
-- a row per API request, so a build must not block its inserts, and a rerun
-- after a failed build must converge.

-- The events of one type, newest or oldest first. A type belongs to one
-- category, so this read takes no category beside it.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_type;
CREATE INDEX CONCURRENTLY idx_events_project_type
    ON zitadel_nextgen.events (project_id, event_type, created_at, id);

-- What one actor did, by category, for the reason the session's index holds
-- the category (000040): an actor's events are mostly its API requests.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_actor_category;
CREATE INDEX CONCURRENTLY idx_events_project_actor_category
    ON zitadel_nextgen.events (project_id, actor_id, category, created_at, id)
    WHERE actor_id IS NOT NULL;

-- What happened to one resource, by category: a user's sign-ins are a range
-- apart from the changes made to that user. An API request names no resource,
-- so this leaves most rows out.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_entity_category;
CREATE INDEX CONCURRENTLY idx_events_project_entity_category
    ON zitadel_nextgen.events (project_id, entity_id, category, created_at, id)
    WHERE entity_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_entity_category;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_actor_category;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_type;
