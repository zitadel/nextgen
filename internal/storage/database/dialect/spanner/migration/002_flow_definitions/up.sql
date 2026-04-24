CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.flow_definitions (
    instance_id     STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    name            STRING(MAX) NOT NULL,
    engine_version  STRING(MAX) NOT NULL,
    schema_version  STRING(MAX) NOT NULL,
    status          STRING(MAX) NOT NULL DEFAULT ('draft'),
    created_at      TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
) PRIMARY KEY (instance_id, id);

CREATE INDEX idx_flow_definitions_instance_status
    ON zitadel_nextgen.flow_definitions (instance_id, status);

CREATE TABLE zitadel_nextgen.flow_definition_purposes (
    instance_id     STRING(MAX) NOT NULL,
    definition_id   STRING(MAX) NOT NULL,
    purpose         STRING(MAX) NOT NULL,
    initial_step    STRING(MAX) NOT NULL,
    FOREIGN KEY (instance_id, definition_id)
        REFERENCES zitadel_nextgen.flow_definitions (instance_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, definition_id, purpose);

CREATE TABLE zitadel_nextgen.flow_definition_audiences (
    instance_id         STRING(MAX) NOT NULL,
    definition_id       STRING(MAX) NOT NULL,
    app_id              STRING(MAX),
    org_id              STRING(MAX),
    schema_id           STRING(MAX),
    is_instance_default BOOL NOT NULL DEFAULT (false),
    FOREIGN KEY (instance_id, definition_id)
        REFERENCES zitadel_nextgen.flow_definitions (instance_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, definition_id);

CREATE TABLE zitadel_nextgen.flow_definition_steps (
    instance_id     STRING(MAX) NOT NULL,
    definition_id   STRING(MAX) NOT NULL,
    name            STRING(MAX) NOT NULL,
    type            STRING(MAX) NOT NULL,
    config          JSON,
    FOREIGN KEY (instance_id, definition_id)
        REFERENCES zitadel_nextgen.flow_definitions (instance_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, definition_id, name);

CREATE TABLE zitadel_nextgen.flow_definition_step_transitions (
    instance_id     STRING(MAX) NOT NULL,
    definition_id   STRING(MAX) NOT NULL,
    step_name       STRING(MAX) NOT NULL,
    action          STRING(MAX) NOT NULL,
    target_step     STRING(MAX),
    pivot_purpose   STRING(MAX),
    FOREIGN KEY (instance_id, definition_id, step_name)
        REFERENCES zitadel_nextgen.flow_definition_steps (instance_id, definition_id, name)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, definition_id, step_name, action);
