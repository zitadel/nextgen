-- Spanner has no schemas; the zitadel_nextgen namespace is expressed via
-- the table name prefix or a database-per-environment convention.
CREATE TABLE instances (
    id         STRING(MAX) NOT NULL CHECK (id != ''),
    created_at TIMESTAMP   NOT NULL,
    updated_at TIMESTAMP   NOT NULL,
) PRIMARY KEY (id);
