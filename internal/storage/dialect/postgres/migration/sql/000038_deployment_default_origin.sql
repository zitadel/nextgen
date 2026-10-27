-- +goose Up
-- The default target is the empty origin. A web origin stays non-empty
-- because NormalizeOrigin rejects one; this check was the other half.
ALTER TABLE zitadel_nextgen.deployment_origins
    DROP CONSTRAINT deployment_origins_origin_check;

-- +goose Down
DELETE FROM zitadel_nextgen.deployment_origins WHERE origin = '';
ALTER TABLE zitadel_nextgen.deployment_origins
    ADD CONSTRAINT deployment_origins_origin_check CHECK (origin <> '');
