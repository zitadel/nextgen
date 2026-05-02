-- +goose NO TRANSACTION
-- +goose Up
CREATE TABLE zitadel_nextgen.organizations (
    instance_id STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
) PRIMARY KEY (instance_id, id),
  INTERLEAVE IN PARENT zitadel_nextgen.instances ON DELETE CASCADE;

-- +goose Down
-- +goose NO TRANSACTION
DROP TABLE IF EXISTS zitadel_nextgen.organizations;
