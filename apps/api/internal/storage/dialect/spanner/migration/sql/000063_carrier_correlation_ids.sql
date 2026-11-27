-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000059_carrier_correlation_ids.sql).
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN correlation_id STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE auth_attempts ADD COLUMN correlation_id STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE claim_challenges ADD COLUMN correlation_id STRING(MAX)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE claim_challenges DROP COLUMN correlation_id
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE auth_attempts DROP COLUMN correlation_id
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN correlation_id
-- +goose StatementEnd
