CREATE TABLE zitadel_nextgen.flow_definitions (
    instance_id     TEXT NOT NULL
    , id            TEXT NOT NULL CHECK (id <> '')
    , name          TEXT NOT NULL CHECK (name <> '')
    , engine_version TEXT NOT NULL CHECK (engine_version <> '')
    , schema_version TEXT NOT NULL CHECK (schema_version <> '')
    , status        TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'deprecated', 'archived'))
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (instance_id, id)
);

CREATE INDEX idx_flow_definitions_instance_status
    ON zitadel_nextgen.flow_definitions (instance_id, status);

CREATE TABLE zitadel_nextgen.flow_definition_purposes (
    instance_id     TEXT NOT NULL
    , definition_id TEXT NOT NULL CHECK (definition_id <> '')
    , purpose       TEXT NOT NULL
                        CHECK (purpose IN ('login', 'register', 'recovery', 'profiling', 'reauth', 'link_account'))
    , initial_step  TEXT NOT NULL CHECK (initial_step <> '')

    , PRIMARY KEY (instance_id, definition_id, purpose)
    , FOREIGN KEY (instance_id, definition_id)
        REFERENCES zitadel_nextgen.flow_definitions (instance_id, id)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.flow_definition_audiences (
    instance_id         TEXT NOT NULL
    , definition_id     TEXT NOT NULL CHECK (definition_id <> '')
    , app_id            TEXT
    , org_id            TEXT
    , schema_id         TEXT
    , is_instance_default BOOLEAN NOT NULL DEFAULT false

    , PRIMARY KEY (instance_id, definition_id)
    , FOREIGN KEY (instance_id, definition_id)
        REFERENCES zitadel_nextgen.flow_definitions (instance_id, id)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.flow_definition_steps (
    instance_id     TEXT NOT NULL
    , definition_id TEXT NOT NULL CHECK (definition_id <> '')
    , name          TEXT NOT NULL CHECK (name <> '')
    , type          TEXT NOT NULL
                        CHECK (type IN (
                            'identifier', 'credential', 'form', 'verification',
                            'policy_check', 'action', 'consent', 'captcha',
                            'redirect', 'info', 'complete'
                        ))
    , config        JSONB

    , PRIMARY KEY (instance_id, definition_id, name)
    , FOREIGN KEY (instance_id, definition_id)
        REFERENCES zitadel_nextgen.flow_definitions (instance_id, id)
        ON DELETE CASCADE
);

CREATE TABLE zitadel_nextgen.flow_definition_step_transitions (
    instance_id     TEXT NOT NULL
    , definition_id TEXT NOT NULL CHECK (definition_id <> '')
    , step_name     TEXT NOT NULL CHECK (step_name <> '')
    , action        TEXT NOT NULL CHECK (action <> '')
    , target_step   TEXT
    , pivot_purpose TEXT
                        CHECK (pivot_purpose IN ('login', 'register', 'recovery', 'profiling', 'reauth', 'link_account'))

    , PRIMARY KEY (instance_id, definition_id, step_name, action)
    , FOREIGN KEY (instance_id, definition_id, step_name)
        REFERENCES zitadel_nextgen.flow_definition_steps (instance_id, definition_id, name)
        ON DELETE CASCADE
    , CHECK (
        (target_step IS NOT NULL AND pivot_purpose IS NULL)
        OR (target_step IS NULL AND pivot_purpose IS NOT NULL)
    )
);
