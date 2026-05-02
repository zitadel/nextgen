-- +goose NO TRANSACTION
-- +goose Up
CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.instances (
    id          STRING(MAX) NOT NULL CHECK (id != ''),
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
) PRIMARY KEY (id);

-- +goose Down
-- +goose NO TRANSACTION
DROP TABLE IF EXISTS zitadel_nextgen.instances;
DROP SCHEMA IF EXISTS zitadel_nextgen;
