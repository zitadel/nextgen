-- +goose NO TRANSACTION
-- +goose Up
-- What delivery keeps on a webhook (ADR 088 §4); see the postgres migration.
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN next_attempt_at TIMESTAMP
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN failing_since TIMESTAMP
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN lease_holder STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN lease_expires_at TIMESTAMP
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN lease_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN lease_holder
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN failing_since
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN next_attempt_at
-- +goose StatementEnd
