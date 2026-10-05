-- +goose Up
-- Wrong passwords slow down further checks of a user's password (#1356). Each
-- one is its own row, so concurrent failures all count without contending
-- for one counter. They belong to the user, not to a password row, so a new
-- password does not wipe them. A failure stops counting after
-- domain.UserPasswordFailureWindow and is dropped by the next one recorded,
-- or by a correct password; see domain.UserPasswordFailures.
CREATE TABLE zitadel_nextgen.user_password_failures (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , user_id TEXT COLLATE "C" NOT NULL
    , failed_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_user_password_failures_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users (project_id, id)
        ON DELETE CASCADE
);

-- Serves the count of a user's recent failures, their pruning, and the
-- user-delete cascade.
CREATE INDEX idx_user_password_failures_user_failed_at
    ON zitadel_nextgen.user_password_failures (project_id, user_id, failed_at);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_user_password_failures_user_failed_at;
DROP TABLE IF EXISTS zitadel_nextgen.user_password_failures;
