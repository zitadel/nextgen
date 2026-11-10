-- +goose NO TRANSACTION
-- +goose Up
-- Folds the user_unique_attributes registry into user_attributes. See the
-- postgres peer (000039_fold_user_unique_attributes.sql) for the reasons and
-- the measurements. The foreign key from tokens to users already has a managed
-- backing index on (project_id, user_id), which serves the cascade.

-- +goose StatementBegin
ALTER TABLE user_attributes ADD COLUMN unique_team_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_attributes ADD COLUMN value_hash BYTES(32)
-- +goose StatementEnd
-- +goose StatementBegin
-- A hash without a team scope would escape the NULL_FILTERED unique index.
ALTER TABLE user_attributes ADD CONSTRAINT user_attributes_unique_team_id_check
    CHECK (value_hash IS NULL OR unique_team_id IS NOT NULL)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE user_attributes a
SET unique_team_id = (
        SELECT u.team_id FROM user_unique_attributes u
        WHERE u.project_id = a.project_id AND u.user_id = a.user_id AND u.key = a.key
    ),
    value_hash = (
        SELECT u.value_hash FROM user_unique_attributes u
        WHERE u.project_id = a.project_id AND u.user_id = a.user_id AND u.key = a.key
    )
WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE user_unique_attributes
-- +goose StatementEnd
-- +goose StatementBegin
-- Spanner refuses to drop a column an index names.
DROP INDEX idx_user_attributes_team_id
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_user_attributes_scalar
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN team_id
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_attributes_scalar
    ON user_attributes (key)
    STORING (value)
-- +goose StatementEnd
-- +goose StatementBegin
-- Enforces uniqueness and serves the lookup with or without a team scope.
-- NULL_FILTERED leaves out the attributes that are not unique.
CREATE UNIQUE NULL_FILTERED INDEX idx_user_attributes_unique
    ON user_attributes (project_id, key, value_hash, unique_team_id)
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE TABLE user_unique_attributes (
    project_id  STRING(MAX) NOT NULL,
    user_id     STRING(MAX) NOT NULL,
    team_id     STRING(MAX) NOT NULL,
    key         STRING(MAX) NOT NULL,
    value_hash  BYTES(32)   NOT NULL,
    CONSTRAINT fk_user_unique_attributes_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, team_id, key, value_hash)
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO user_unique_attributes (project_id, user_id, team_id, key, value_hash)
SELECT project_id, user_id, unique_team_id, key, value_hash
FROM user_attributes
WHERE value_hash IS NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_user_attributes_unique
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_user_attributes_scalar
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_attributes DROP CONSTRAINT user_attributes_unique_team_id_check
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN value_hash
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN unique_team_id
-- +goose StatementEnd
-- +goose StatementBegin
-- Nullable: Spanner adds a NOT NULL column only with a default. Nothing reads
-- team_id.
ALTER TABLE user_attributes ADD COLUMN team_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_attributes_scalar
    ON user_attributes (key, team_id)
    STORING (value)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_attributes_team_id
    ON user_attributes (team_id)
-- +goose StatementEnd