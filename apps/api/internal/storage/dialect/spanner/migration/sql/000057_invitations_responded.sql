-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE invitations DROP CONSTRAINT chk_invitations_accepted
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations DROP COLUMN accepted_by
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations DROP COLUMN accepted_at
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations ADD COLUMN responded_by STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations ADD COLUMN responded_at TIMESTAMP
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations ADD CONSTRAINT chk_invitations_responded CHECK ((status != 'pending') = (responded_by IS NOT NULL AND responded_at IS NOT NULL))
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE invitations DROP CONSTRAINT chk_invitations_responded
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations DROP COLUMN responded_at
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations DROP COLUMN responded_by
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations ADD COLUMN accepted_by STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations ADD COLUMN accepted_at TIMESTAMP
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE invitations ADD CONSTRAINT chk_invitations_accepted CHECK ((status = 'accepted') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
-- +goose StatementEnd
