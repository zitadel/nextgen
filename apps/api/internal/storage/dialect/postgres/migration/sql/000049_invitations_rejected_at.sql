-- +goose Up
-- When the invitee declined (ADR 086). Set only on rejected, as accepted_at is
-- only on accepted.
ALTER TABLE zitadel_nextgen.invitations
    ADD COLUMN rejected_at TIMESTAMPTZ;

ALTER TABLE zitadel_nextgen.invitations
    ADD CONSTRAINT chk_invitations_rejected CHECK ((status = 'rejected') = (rejected_at IS NOT NULL));

-- +goose Down
ALTER TABLE zitadel_nextgen.invitations
    DROP CONSTRAINT IF EXISTS chk_invitations_rejected;

ALTER TABLE zitadel_nextgen.invitations
    DROP COLUMN IF EXISTS rejected_at;
