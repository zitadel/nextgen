-- +goose NO TRANSACTION
-- +goose Up
-- The expiry a preview deployment set on each of its origins, written once
-- when the deployment is made. previews.expires_at is renewed by every later
-- deployment to the URL, so it cannot say what an earlier deployment set. NULL
-- on a primary deployment.
--
-- A nullable column without a default changes only the catalog.
ALTER TABLE zitadel_nextgen.deployment_origins
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- The newest preview deployment of each URL is the one whose expiry the
-- previews row holds, so it takes it. A URL whose preview was removed or
-- swept has no row and stays NULL, and so does every earlier preview
-- deployment, whose expiry was overwritten and cannot be recovered: the API
-- reports those without an expires_at.
UPDATE zitadel_nextgen.deployment_origins o
SET expires_at = p.expires_at
FROM zitadel_nextgen.previews p
WHERE o.origin_kind = 'preview'
  AND o.expires_at IS NULL
  AND p.project_id = o.project_id
  AND p.origin = o.origin
  AND NOT EXISTS (
      SELECT 1 FROM zitadel_nextgen.deployment_origins newer
      WHERE newer.project_id = o.project_id
        AND newer.origin = o.origin
        AND newer.origin_kind = 'preview'
        AND newer.seq > o.seq
  );

-- +goose Down
ALTER TABLE zitadel_nextgen.deployment_origins
    DROP COLUMN IF EXISTS expires_at;
