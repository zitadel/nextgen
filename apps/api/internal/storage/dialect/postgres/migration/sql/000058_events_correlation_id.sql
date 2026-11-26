-- +goose NO TRANSACTION
-- +goose Up
-- The chain an event belongs to: the requests one piece of work took,
-- whoever sent them (ADR 048, amendment of 2026-11-26). A request inherits it
-- from the stored thing that brought it, an authorization request, a login
-- flow, an auth attempt, an invitation or a claim challenge. NULL on an event
-- whose request is the whole of its work. GET /events reads it as
-- correlation_id.
--
-- A nullable column without a default changes only the catalog, so the ALTER
-- holds its lock for a moment and rewrites nothing. The events already stored
-- are not filled in: they age out of retention.
ALTER TABLE zitadel_nextgen.events
    ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- CONCURRENTLY and the DROP before the CREATE are as in 000040: events takes
-- a row per API request, so a build must not block its inserts, and a rerun
-- after a failed build must converge.

-- The events of one chain. By time and no category, as the request's and the
-- login flow's indexes: a chain holds few events. Most events are in no
-- chain, so this leaves most rows out.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_correlation;
CREATE INDEX CONCURRENTLY idx_events_project_correlation
    ON zitadel_nextgen.events (project_id, correlation_id, created_at, id)
    WHERE correlation_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_correlation;
ALTER TABLE zitadel_nextgen.events
    DROP COLUMN IF EXISTS correlation_id;
