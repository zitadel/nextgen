-- +goose Up
-- +goose NO TRANSACTION
-- INTERLEAVE IN PARENT physically co-locates organizations with their parent
-- instance row and provides the same ON DELETE CASCADE semantics as the
-- Postgres REFERENCES ... ON DELETE CASCADE.
CREATE TABLE organizations (
    instance_id STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL CHECK (id != ''),
    created_at  TIMESTAMP   NOT NULL,
    updated_at  TIMESTAMP   NOT NULL,
) PRIMARY KEY (instance_id, id),
  INTERLEAVE IN PARENT instances ON DELETE CASCADE;

-- +goose Down
-- +goose NO TRANSACTION
DROP TABLE organizations;
