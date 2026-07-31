-- +goose Up
ALTER TABLE zitadel_nextgen.teams
    ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'deactivated', 'pending_purge'));

ALTER TABLE zitadel_nextgen.users
    ADD COLUMN lifecycle_owner_team_id TEXT COLLATE "C",
    ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deactivated', 'pending_purge'));

-- Conservative alpha default: map legacy users.team_id to lifecycle_owner_team_id.
-- Old schema required a team context for every user, so we cannot distinguish
-- self-serve vs enterprise provenance. Post-migration creates use
-- InitialMembershipTeamID only (self-owned) unless LifecycleOwnerTeamID is set.
UPDATE zitadel_nextgen.users
SET lifecycle_owner_team_id = team_id
WHERE team_id IS NOT NULL AND team_id <> '';

CREATE TABLE zitadel_nextgen.team_memberships (
    project_id  TEXT COLLATE "C" NOT NULL,
    team_id     TEXT COLLATE "C" NOT NULL,
    user_id     TEXT COLLATE "C" NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'inactive', 'removed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (project_id, team_id, user_id),
    -- teams/users stay RESTRICT (ADR 024: team/user deletion goes through a
    -- lifecycle service, not a raw cascade); project deletion gets its own path.
    CONSTRAINT fk_team_memberships_project
        FOREIGN KEY (project_id)
        REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE,
    FOREIGN KEY (project_id, team_id)
        REFERENCES zitadel_nextgen.teams (project_id, id)
        ON DELETE RESTRICT,
    FOREIGN KEY (project_id, user_id)
        REFERENCES zitadel_nextgen.users (project_id, id)
        ON DELETE RESTRICT
);

INSERT INTO zitadel_nextgen.team_memberships (project_id, team_id, user_id, status)
SELECT project_id, team_id, id, 'active'
FROM zitadel_nextgen.users
WHERE team_id IS NOT NULL AND team_id <> '';

ALTER TABLE zitadel_nextgen.users
    DROP CONSTRAINT IF EXISTS users_project_id_team_id_fkey;

DROP INDEX IF EXISTS zitadel_nextgen.idx_users_team_id;

ALTER TABLE zitadel_nextgen.users
    DROP COLUMN team_id;

ALTER TABLE zitadel_nextgen.users
    ADD CONSTRAINT users_lifecycle_owner_team_fkey
        FOREIGN KEY (project_id, lifecycle_owner_team_id)
        REFERENCES zitadel_nextgen.teams (project_id, id)
        ON DELETE RESTRICT;

CREATE INDEX idx_users_lifecycle_owner_team_id
    ON zitadel_nextgen.users (project_id, lifecycle_owner_team_id)
    WHERE lifecycle_owner_team_id IS NOT NULL;

CREATE INDEX idx_team_memberships_user
    ON zitadel_nextgen.team_memberships (project_id, user_id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_team_memberships_user;
DROP INDEX IF EXISTS zitadel_nextgen.idx_users_lifecycle_owner_team_id;

ALTER TABLE zitadel_nextgen.users
    DROP CONSTRAINT IF EXISTS users_lifecycle_owner_team_fkey;

ALTER TABLE zitadel_nextgen.users
    ADD COLUMN team_id TEXT COLLATE "C";

UPDATE zitadel_nextgen.users u
SET team_id = COALESCE(u.lifecycle_owner_team_id, m.team_id)
FROM (
    SELECT DISTINCT ON (project_id, user_id) project_id, user_id, team_id
    FROM zitadel_nextgen.team_memberships
    ORDER BY project_id, user_id, created_at
) m
WHERE u.project_id = m.project_id AND u.id = m.user_id;

ALTER TABLE zitadel_nextgen.users
    ADD CONSTRAINT users_project_id_team_id_fkey
        FOREIGN KEY (project_id, team_id)
        REFERENCES zitadel_nextgen.teams (project_id, id)
        ON DELETE CASCADE;

CREATE INDEX idx_users_team_id
    ON zitadel_nextgen.users (project_id, team_id);

DROP TABLE IF EXISTS zitadel_nextgen.team_memberships;

ALTER TABLE zitadel_nextgen.users
    DROP COLUMN IF EXISTS lifecycle_owner_team_id,
    DROP COLUMN IF EXISTS status;

ALTER TABLE zitadel_nextgen.teams
    DROP COLUMN IF EXISTS status;
