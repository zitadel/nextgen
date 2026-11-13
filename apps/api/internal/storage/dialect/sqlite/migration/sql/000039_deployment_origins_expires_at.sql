-- +goose Up
-- See the postgres peer (000052_deployment_origins_expires_at.sql) for the
-- column and the backfill. Unix nanoseconds, as deployed_at is.
-- +goose StatementBegin
ALTER TABLE deployment_origins ADD COLUMN expires_at INTEGER;
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE deployment_origins
SET expires_at = (
    SELECT p.expires_at FROM previews p
    WHERE p.project_id = deployment_origins.project_id AND p.origin = deployment_origins.origin
)
WHERE origin_kind = 'preview'
  AND expires_at IS NULL
  AND EXISTS (
      SELECT 1 FROM previews p
      WHERE p.project_id = deployment_origins.project_id AND p.origin = deployment_origins.origin
  )
  AND NOT EXISTS (
      SELECT 1 FROM deployment_origins newer
      WHERE newer.project_id = deployment_origins.project_id
        AND newer.origin = deployment_origins.origin
        AND newer.origin_kind = 'preview'
        AND newer.seq > deployment_origins.seq
  );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE deployment_origins DROP COLUMN expires_at;
-- +goose StatementEnd
