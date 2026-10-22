-- +goose Up
-- Keep a user's previous passwords, so a password policy can block reuse
-- (#898). Setting a password now adds a row instead of overwriting the user's
-- one row: the newest row is the current password, the older ones are its
-- history, of which reads return the newest four
-- (domain.UserPasswordHistoryDepth). Nothing removes older rows yet; that is
-- left to a sweep (ADR 065). This is the newest-by-created_at rule
-- idp_connection_revisions uses (ADR 063 section 7).

-- A row's created_at becomes when its password was set, which is what
-- changed_at held: the upsert kept created_at from the first set.
UPDATE zitadel_nextgen.user_passwords SET created_at = changed_at;

ALTER TABLE zitadel_nextgen.user_passwords
    DROP CONSTRAINT user_passwords_project_id_user_id_key,
    DROP COLUMN changed_at;

-- Two passwords of one user stamped at the same instant have no newest, so
-- uniqueness rules that out: the second write fails instead of one of the two
-- being picked at random. SetUserPassword stamps clock_timestamp(), not now(),
-- so two sets in one transaction still differ. The index serves the current
-- password lookup and the newest-first history, and drives the user-delete
-- cascade the dropped unique constraint used to.
CREATE UNIQUE INDEX uq_user_passwords_user_created_at
    ON zitadel_nextgen.user_passwords (project_id, user_id, created_at);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.uq_user_passwords_user_created_at;
-- Only the current password survives the way back.
DELETE FROM zitadel_nextgen.user_passwords p
WHERE EXISTS (
    SELECT 1 FROM zitadel_nextgen.user_passwords newer
    WHERE newer.project_id = p.project_id
        AND newer.user_id = p.user_id
        AND newer.created_at > p.created_at
);
ALTER TABLE zitadel_nextgen.user_passwords
    ADD COLUMN changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD CONSTRAINT user_passwords_project_id_user_id_key UNIQUE (project_id, user_id);
UPDATE zitadel_nextgen.user_passwords SET changed_at = created_at;
