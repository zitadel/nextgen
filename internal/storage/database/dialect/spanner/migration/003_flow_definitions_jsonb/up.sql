CREATE TABLE zitadel_nextgen.flow_definitions_jsonb (
    instance_id     STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    name            STRING(MAX) NOT NULL,
    engine_version  STRING(MAX) NOT NULL,
    schema_version  STRING(MAX) NOT NULL,
    status          STRING(MAX) NOT NULL DEFAULT ('draft'),
    definition      JSON NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
) PRIMARY KEY (instance_id, id);

CREATE INDEX idx_flow_definitions_jsonb_instance_status
    ON zitadel_nextgen.flow_definitions_jsonb (instance_id, status);
