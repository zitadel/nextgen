-- +goose Up
-- Who accepted or declined the link and when; status says which (ADR 086).
-- They replace accepted_by and accepted_at. No row was accepted or declined
-- before this migration, so nothing is copied.
ALTER TABLE zitadel_nextgen.invitations
    DROP CONSTRAINT IF EXISTS chk_invitations_accepted;

ALTER TABLE zitadel_nextgen.invitations
    DROP COLUMN IF EXISTS accepted_by,
    DROP COLUMN IF EXISTS accepted_at,
    ADD COLUMN responded_by TEXT COLLATE "C",
    ADD COLUMN responded_at TIMESTAMPTZ;

ALTER TABLE zitadel_nextgen.invitations
    ADD CONSTRAINT chk_invitations_responded CHECK (
        (status <> 'pending') = (responded_by IS NOT NULL AND responded_at IS NOT NULL)
    );

-- +goose Down
ALTER TABLE zitadel_nextgen.invitations
    DROP CONSTRAINT IF EXISTS chk_invitations_responded;

ALTER TABLE zitadel_nextgen.invitations
    DROP COLUMN IF EXISTS responded_by,
    DROP COLUMN IF EXISTS responded_at,
    ADD COLUMN accepted_by TEXT COLLATE "C",
    ADD COLUMN accepted_at TIMESTAMPTZ;

ALTER TABLE zitadel_nextgen.invitations
    ADD CONSTRAINT chk_invitations_accepted CHECK (
        (status = 'accepted') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
    );
