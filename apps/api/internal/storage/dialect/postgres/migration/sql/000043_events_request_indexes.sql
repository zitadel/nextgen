-- +goose NO TRANSACTION
-- +goose Up
-- Three more filters of GET /events read an index, after the seven in 000040
-- and 000041: the type of resource an event affected, and the operation and
-- the response status class of an API request (ADR 048, amendment of
-- 2026-11-10 on the request filters).
--
-- status_class is the class of a request.api event's status, "4xx", and
-- operation_status its operation with that class, "createUser 4xx"
-- (events.OperationStatus), both copied from the payload when the event is
-- written (RequestAPIPayload.Indexed). Every other event leaves them NULL. A
-- nullable column without a default changes only the catalog, so the ALTER
-- holds its lock for a moment and rewrites nothing. The events already stored
-- are not filled in: they age out of retention, and a list by operation or
-- status class matches the requests recorded from here on.
ALTER TABLE zitadel_nextgen.events
    ADD COLUMN IF NOT EXISTS operation_status TEXT,
    ADD COLUMN IF NOT EXISTS status_class TEXT;

-- CONCURRENTLY and the DROP before each CREATE are as in 000040: events takes
-- a row per API request, so a build must not block its inserts, and a rerun
-- after a failed build must converge.

-- The events on one type of resource, by category, for the reason the
-- resource's index holds the category (000041): a type's events are mostly
-- of one category, a user's sign-ins beside the changes made to users. An
-- API request names no resource, so this leaves most rows out.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_entity_type_category;
CREATE INDEX CONCURRENTLY idx_events_project_entity_type_category
    ON zitadel_nextgen.events (project_id, entity_type, category, created_at, id)
    WHERE entity_type IS NOT NULL;

-- The requests to one operation in one status class: an operation's failed
-- calls are a range apart from its successful ones, however many of those
-- there are. A list by operation alone reads each class and merges them
-- (events.ListEach). The operation and the class are one column, so that a
-- read by both names no column the status index below holds: Postgres took
-- that smaller index, matching the operation row by row, whenever it expected
-- at most a row from either.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_operation_status;
CREATE INDEX CONCURRENTLY idx_events_project_operation_status
    ON zitadel_nextgen.events (project_id, operation_status, created_at, id)
    WHERE operation_status IS NOT NULL;

-- The requests of one status class, whatever their operation.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_status;
CREATE INDEX CONCURRENTLY idx_events_project_status
    ON zitadel_nextgen.events (project_id, status_class, created_at, id)
    WHERE status_class IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_status;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_operation_status;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_entity_type_category;
ALTER TABLE zitadel_nextgen.events
    DROP COLUMN IF EXISTS status_class,
    DROP COLUMN IF EXISTS operation_status;
