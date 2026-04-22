-- +goose Up
-- +goose NO TRANSACTION
-- Spanner has no schemas; the database itself is the namespace boundary.
CREATE TABLE instances (
    id         STRING(MAX) NOT NULL CHECK (id != ''),
    created_at TIMESTAMP   NOT NULL,
    updated_at TIMESTAMP   NOT NULL,
) PRIMARY KEY (id);

-- +goose Down
-- +goose NO TRANSACTION
DROP TABLE instances;
