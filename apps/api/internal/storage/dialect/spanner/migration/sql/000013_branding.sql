-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE branding (
    project_id  STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    definition  JSON        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_branding_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_branding_project_created_at
    ON branding (project_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_branding_project_created_at
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS branding
-- +goose StatementEnd
