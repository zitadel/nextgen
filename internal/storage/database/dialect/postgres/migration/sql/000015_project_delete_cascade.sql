-- +goose Up
-- Users are project-scoped (ADR 024); 000011 removed their team cascade path.
ALTER TABLE zitadel_nextgen.users
    ADD CONSTRAINT fk_users_project
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE;

-- Carried project_id but no foreign key, so these outlived their project.
ALTER TABLE zitadel_nextgen.flow_definitions
    ADD CONSTRAINT fk_flow_definitions_project
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE;

ALTER TABLE zitadel_nextgen.passkey_registrations
    ADD CONSTRAINT fk_passkey_registrations_project
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE;

-- team_memberships has RESTRICT FKs to teams/users (ADR 024: team/user
-- deletion must go through a lifecycle service, not a raw cascade);
-- project deletion gets its own direct path instead.
ALTER TABLE zitadel_nextgen.team_memberships
    ADD CONSTRAINT fk_team_memberships_project
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE;

-- Had the project FK but not the cascade; reuse the auto-generated names so a
-- migrated schema matches a fresh install.
ALTER TABLE zitadel_nextgen.auth_attempts
    DROP CONSTRAINT auth_attempts_project_id_fkey,
    ADD CONSTRAINT auth_attempts_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE;

ALTER TABLE zitadel_nextgen.user_agents
    DROP CONSTRAINT user_agents_project_id_fkey,
    ADD CONSTRAINT user_agents_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE;

ALTER TABLE zitadel_nextgen.sessions
    DROP CONSTRAINT sessions_project_id_fkey,
    ADD CONSTRAINT sessions_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE;

-- +goose Down
ALTER TABLE zitadel_nextgen.sessions
    DROP CONSTRAINT sessions_project_id_fkey,
    ADD CONSTRAINT sessions_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id);

ALTER TABLE zitadel_nextgen.user_agents
    DROP CONSTRAINT user_agents_project_id_fkey,
    ADD CONSTRAINT user_agents_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id);

ALTER TABLE zitadel_nextgen.auth_attempts
    DROP CONSTRAINT auth_attempts_project_id_fkey,
    ADD CONSTRAINT auth_attempts_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id);

ALTER TABLE zitadel_nextgen.team_memberships
    DROP CONSTRAINT IF EXISTS fk_team_memberships_project;

ALTER TABLE zitadel_nextgen.passkey_registrations
    DROP CONSTRAINT IF EXISTS fk_passkey_registrations_project;

ALTER TABLE zitadel_nextgen.flow_definitions
    DROP CONSTRAINT IF EXISTS fk_flow_definitions_project;

ALTER TABLE zitadel_nextgen.users
    DROP CONSTRAINT IF EXISTS fk_users_project;