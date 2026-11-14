-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000052_deployment_origins_expires_at.sql) for the
-- column and the backfill.
-- +goose StatementBegin
ALTER TABLE deployment_origins ADD COLUMN expires_at TIMESTAMP
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE deployment_origins o
SET expires_at = (
    SELECT p.expires_at FROM previews p
    WHERE p.project_id = o.project_id AND p.origin = o.origin
)
WHERE o.origin_kind = 'preview'
  AND o.expires_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM deployment_origins newer
      WHERE newer.project_id = o.project_id
        AND newer.origin = o.origin
        AND newer.origin_kind = 'preview'
        AND newer.seq > o.seq
  )
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE deployment_origins DROP COLUMN expires_at
-- +goose StatementEnd
