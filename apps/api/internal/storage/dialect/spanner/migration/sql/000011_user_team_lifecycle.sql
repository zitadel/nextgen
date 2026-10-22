-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
ALTER TABLE teams ADD COLUMN status STRING(MAX) NOT NULL DEFAULT ('active')
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users ADD COLUMN lifecycle_owner_team_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users ADD COLUMN status STRING(MAX) NOT NULL DEFAULT ('active')
-- +goose StatementEnd
-- +goose StatementBegin
-- Conservative alpha default: map legacy users.team_id to lifecycle_owner_team_id.
-- Old schema required a team context for every user, so we cannot distinguish
-- self-serve vs enterprise provenance. Post-migration creates use
-- InitialMembershipTeamID only (self-owned) unless LifecycleOwnerTeamID is set.
UPDATE users SET lifecycle_owner_team_id = team_id WHERE team_id IS NOT NULL AND team_id != ''
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE team_memberships (
    project_id  STRING(MAX) NOT NULL,
    team_id     STRING(MAX) NOT NULL,
    user_id     STRING(MAX) NOT NULL,
    status      STRING(MAX) NOT NULL DEFAULT ('active'),
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    -- teams/users stay NO ACTION (ADR 024: team/user deletion goes through a
    -- lifecycle service, not a raw cascade); project deletion gets its own path.
    CONSTRAINT fk_team_memberships_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_team_memberships_team
        FOREIGN KEY (project_id, team_id)
        REFERENCES teams (project_id, id)
        ON DELETE NO ACTION,
    CONSTRAINT fk_team_memberships_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE NO ACTION
) PRIMARY KEY (project_id, team_id, user_id)
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO team_memberships (project_id, team_id, user_id, status)
SELECT project_id, team_id, id, 'active'
FROM users
WHERE team_id IS NOT NULL AND team_id != ''
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users DROP CONSTRAINT fk_users_team
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_users_team_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN team_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users ADD CONSTRAINT fk_users_lifecycle_owner_team
    FOREIGN KEY (project_id, lifecycle_owner_team_id)
    REFERENCES teams (project_id, id)
    ON DELETE NO ACTION
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_users_lifecycle_owner_team_id
    ON users (lifecycle_owner_team_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_team_memberships_user
    ON team_memberships (user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX idx_team_memberships_user
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_users_lifecycle_owner_team_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users DROP CONSTRAINT fk_users_lifecycle_owner_team
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users ADD COLUMN team_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE users u
SET team_id = COALESCE(u.lifecycle_owner_team_id, (
    SELECT m.team_id FROM team_memberships m
    WHERE m.project_id = u.project_id AND m.user_id = u.id
    LIMIT 1
))
WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users ADD CONSTRAINT fk_users_team
    FOREIGN KEY (project_id, team_id)
    REFERENCES teams (project_id, id)
    ON DELETE CASCADE
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_users_team_id ON users (team_id)
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE team_memberships
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN lifecycle_owner_team_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN status
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE teams DROP COLUMN status
-- +goose StatementEnd
