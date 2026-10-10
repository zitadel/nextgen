-- +goose Up
CREATE TABLE IF NOT EXISTS cloud.placements (
    project_id text PRIMARY KEY,
    region_id  text NOT NULL,
    user_id    text NOT NULL,
    team_id    text NOT NULL,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS placements_user_id ON cloud.placements (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS cloud.placements;
