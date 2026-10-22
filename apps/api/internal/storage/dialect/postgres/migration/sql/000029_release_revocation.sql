-- +goose Up
-- Set once by the first revoke, never cleared.
ALTER TABLE zitadel_nextgen.releases ADD COLUMN revoked_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE zitadel_nextgen.releases DROP COLUMN IF EXISTS revoked_at;
