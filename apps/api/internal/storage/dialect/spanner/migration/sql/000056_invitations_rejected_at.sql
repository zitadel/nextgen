-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE invitations ADD COLUMN rejected_at TIMESTAMP
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations ADD CONSTRAINT chk_invitations_rejected CHECK ((status = 'rejected') = (rejected_at IS NOT NULL))
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE invitations DROP CONSTRAINT chk_invitations_rejected
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations DROP COLUMN rejected_at
-- +goose StatementEnd
