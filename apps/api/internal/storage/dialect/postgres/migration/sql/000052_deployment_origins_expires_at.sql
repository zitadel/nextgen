-- +goose NO TRANSACTION
-- +goose Up
-- The expiry a preview deployment set on each of its origins, written once
-- when the deployment is made. previews.expires_at is renewed by every later
-- deployment to the URL, so it cannot say what an earlier deployment set. NULL
-- on a primary deployment, and on the preview deployments already stored,
-- which the API then reports without an expires_at.
--
-- A nullable column without a default changes only the catalog.
ALTER TABLE zitadel_nextgen.deployment_origins
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE zitadel_nextgen.deployment_origins
    DROP COLUMN IF EXISTS expires_at;
