-- +goose Up
-- What delivery keeps on a webhook (ADR 089 §4); see the postgres migration.
-- Times are unix nanos.
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN next_attempt_at INTEGER;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN failing_since INTEGER;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN lease_holder TEXT;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks ADD COLUMN lease_expires_at INTEGER;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN lease_expires_at;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN lease_holder;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN failing_since;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE webhooks DROP COLUMN next_attempt_at;
-- +goose StatementEnd
