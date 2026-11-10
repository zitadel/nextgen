-- +goose Up
-- Folds the user_unique_attributes registry into user_attributes. See the
-- postgres peer (000039_fold_user_unique_attributes.sql) for the reasons and
-- the measurements. Unlike the peer, no CHECK ties value_hash to
-- unique_team_id: SQLite cannot drop a column a CHECK names, so the Down
-- would have to rebuild the table.

-- +goose StatementBegin
ALTER TABLE user_attributes ADD COLUMN unique_team_id TEXT;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE user_attributes ADD COLUMN value_hash BLOB;
-- +goose StatementEnd

-- +goose StatementBegin
UPDATE user_attributes
SET unique_team_id = u.team_id, value_hash = u.value_hash
FROM user_unique_attributes u
WHERE u.project_id = user_attributes.project_id
  AND u.user_id = user_attributes.user_id
  AND u.key = user_attributes.key;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE user_unique_attributes;
-- +goose StatementEnd

-- +goose StatementBegin
-- SQLite refuses to drop a column an index names.
DROP INDEX idx_user_attributes_team_id;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX idx_user_attributes_scalar;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN team_id;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_user_attributes_scalar ON user_attributes (key);
-- +goose StatementEnd

-- +goose StatementBegin
-- Enforces uniqueness and serves the lookup with or without a team scope.
CREATE UNIQUE INDEX idx_user_attributes_unique
    ON user_attributes (project_id, key, value_hash, unique_team_id)
    WHERE value_hash IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
-- Serves the cascade from users. Partial: every session starts with an
-- anonymous token whose user_id is NULL, and the cascade never looks for one.
CREATE INDEX idx_tokens_user ON tokens (project_id, user_id) WHERE user_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tokens_user;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_unique_attributes (
    project_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    team_id     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value_hash  BLOB NOT NULL,
    PRIMARY KEY (project_id, team_id, key, value_hash),
    CONSTRAINT fk_user_unique_attributes_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO user_unique_attributes (project_id, user_id, team_id, key, value_hash)
SELECT project_id, user_id, unique_team_id, key, value_hash
FROM user_attributes
WHERE value_hash IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_attributes_unique;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_attributes_scalar;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN value_hash;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE user_attributes DROP COLUMN unique_team_id;
-- +goose StatementEnd

-- +goose StatementBegin
-- Nothing reads team_id, so '' stands in for the value create wrote.
ALTER TABLE user_attributes ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_user_attributes_scalar ON user_attributes (key, team_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_user_attributes_team_id ON user_attributes (team_id);
-- +goose StatementEnd