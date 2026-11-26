-- +goose NO TRANSACTION
-- +goose Up
-- The deployment that served the request an event was emitted in, its
-- release, and the origin that resolved it. NULL on an event no deployment
-- served, such as a resource or project change. GET /events reads them as
-- deployment_id, release_id and target, and filters by the first two, so the
-- events of one release or of one deployment read as a list.
--
-- Nullable columns without a default change only the catalog, as in 000051.
-- The events already stored are not filled in: they age out of retention.
ALTER TABLE zitadel_nextgen.events
    ADD COLUMN IF NOT EXISTS deployment_id TEXT,
    ADD COLUMN IF NOT EXISTS release_id TEXT,
    ADD COLUMN IF NOT EXISTS target TEXT;

-- CONCURRENTLY and the DROP before the CREATE are as in 000040. Only events of
-- a served request carry a deployment, so both indexes leave out the rest.
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_release;
CREATE INDEX CONCURRENTLY idx_events_project_release
    ON zitadel_nextgen.events (project_id, release_id, created_at, id)
    WHERE release_id IS NOT NULL;

DROP INDEX IF EXISTS zitadel_nextgen.idx_events_project_deployment;
CREATE INDEX CONCURRENTLY idx_events_project_deployment
    ON zitadel_nextgen.events (project_id, deployment_id, created_at, id)
    WHERE deployment_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_deployment;
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_events_project_release;
ALTER TABLE zitadel_nextgen.events
    DROP COLUMN IF EXISTS target,
    DROP COLUMN IF EXISTS release_id,
    DROP COLUMN IF EXISTS deployment_id;
