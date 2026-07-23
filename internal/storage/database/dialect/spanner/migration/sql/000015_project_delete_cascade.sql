-- +goose NO TRANSACTION
-- +goose Up
-- Only these project FKs were missing on Spanner; the other child tables
-- already cascade. team_memberships has NO ACTION FKs to teams/users
-- (ADR 024: team/user deletion must go through a lifecycle service, not a
-- raw cascade); project deletion gets its own direct path instead.
-- +goose StatementBegin
ALTER TABLE users ADD CONSTRAINT fk_users_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE flow_definitions ADD CONSTRAINT fk_flow_definitions_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE team_memberships ADD CONSTRAINT fk_team_memberships_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE team_memberships DROP CONSTRAINT fk_team_memberships_project
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE flow_definitions DROP CONSTRAINT fk_flow_definitions_project
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users DROP CONSTRAINT fk_users_project
-- +goose StatementEnd