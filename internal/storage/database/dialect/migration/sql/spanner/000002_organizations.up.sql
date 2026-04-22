-- INTERLEAVE IN PARENT gives the same cascade-delete and locality
-- semantics as the Postgres REFERENCES ... ON DELETE CASCADE.
CREATE TABLE organizations (
    instance_id STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL CHECK (id != ''),
    created_at  TIMESTAMP   NOT NULL,
    updated_at  TIMESTAMP   NOT NULL,
) PRIMARY KEY (instance_id, id),
  INTERLEAVE IN PARENT instances ON DELETE CASCADE;
