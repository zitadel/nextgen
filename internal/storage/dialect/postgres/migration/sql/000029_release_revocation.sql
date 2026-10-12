-- +goose Up
-- A revoked release is never served again. Revocation is the one change a
-- release takes: the first revoke stamps revoked_at and nothing clears it, so
-- the column only ever goes from NULL to a timestamp.
ALTER TABLE zitadel_nextgen.releases ADD COLUMN revoked_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE zitadel_nextgen.releases DROP COLUMN IF EXISTS revoked_at;
