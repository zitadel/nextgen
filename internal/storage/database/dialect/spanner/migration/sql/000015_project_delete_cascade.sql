-- +goose NO TRANSACTION
-- +goose Up
-- Only these two project FKs were missing on Spanner; the other child tables
-- already cascade.
-- +goose StatementBegin
ALTER TABLE users ADD CONSTRAINT fk_users_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE flow_definitions ADD CONSTRAINT fk_flow_definitions_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE flow_definitions DROP CONSTRAINT fk_flow_definitions_project
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE users DROP CONSTRAINT fk_users_project
-- +goose StatementEnd