-- +goose NO TRANSACTION
-- +goose Up
-- events had one secondary index, (project_id, created_at, id), which serves a
-- project's unfiltered list and nothing else: any filter on GET /events walked
-- the project's retained events, newest first, until it had a page. The
-- console's Logs screen reads the list by category and follows one request,
-- session or login flow, so those four reads get an index each (ADR 048,
-- amendment of 2026-11-10). Every other filter the API accepts is still
-- unindexed.
--
-- events takes a row per API request, so every index here is a write on that
-- path. The request, session and flow indexes leave out the rows that carry
-- no such id (a partial index), which for flow_id is most of them. A lookup
-- by equality implies the column is not null, so the planner still uses them.
--
-- CONCURRENTLY, because a plain CREATE INDEX holds a SHARE lock for the whole
-- build, which blocks every event insert and with it every request that
-- records one. That is what NO TRANSACTION above is for. A failed build leaves
-- an INVALID index behind, so each CREATE is preceded by a DROP: a rerun after
-- a failure converges instead of colliding with the leftover (as in 000019).

-- Serves the list by one category, newest or oldest first: a btree scans
-- backward, so one definition covers both directions. Several categories are
-- read one at a time and merged (events.ListEachCategory).
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_category;
CREATE INDEX CONCURRENTLY idx_events_project_category
    ON zitadel_nextgen.events (project_id, category, created_at, id);

-- The events of one HTTP request: its request.api event and what it changed.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_request;
CREATE INDEX CONCURRENTLY idx_events_project_request
    ON zitadel_nextgen.events (project_id, request_id, created_at, id)
    WHERE request_id IS NOT NULL;

-- The events of one session.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_session;
CREATE INDEX CONCURRENTLY idx_events_project_session
    ON zitadel_nextgen.events (project_id, session_id, created_at, id)
    WHERE session_id IS NOT NULL;

-- The events of one login flow.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_flow;
CREATE INDEX CONCURRENTLY idx_events_project_flow
    ON zitadel_nextgen.events (project_id, flow_id, created_at, id)
    WHERE flow_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_flow;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_session;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_request;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_category;
