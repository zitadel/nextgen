-- Seed data for manually testing the flow engine end-to-end.
--
-- Usage:
--   psql "postgresql://postgres:postgres@127.0.0.1:<PORT>/postgres?sslmode=disable" \
--     -f docs/design/flowengine/seed-flow.sql
--
-- After running, exercise the engine with:
--   curl -s -c /tmp/zflow -X POST http://localhost:8080/flow \
--     -H 'content-type: application/json' \
--     -d '{"project_id":"proj-1","purpose":"register"}' | jq
--
--   FLOW_ID=...  # from the response.flow.id
--   curl -s -b /tmp/zflow -c /tmp/zflow -X POST \
--     http://localhost:8080/flow/$FLOW_ID/step \
--     -H 'content-type: application/json' \
--     -d '{"step":"credentials","action":"submit","fields":{"email":"alice@example.com","username":"alice","password":"correct-horse-battery-staple","given_name":"Alice","family_name":"A"}}' | jq

BEGIN;

-- 1. Project ------------------------------------------------------------
INSERT INTO zitadel_nextgen.projects (id)
VALUES ('proj-1')
ON CONFLICT (id) DO NOTHING;

-- 2. User schemas ------------------------------------------------------
-- Flow definitions reference these by URL; the JSONSchemaResolver looks
-- them up by (project_id, url) and feeds them to the field resolver.
INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload)
VALUES (
    'proj-1',
    'https://example.test/user/v1/default.user.schema.json',
    $${
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "x-auth-methods": { "password": { "enabled": true } },
        "required": ["email", "username", "password", "given_name", "family_name"],
        "properties": {
            "email":       { "type": "string", "format": "email", "maxLength": 320, "x-identifier": true },
            "username":    { "type": "string", "minLength": 3, "maxLength": 64, "x-identifier": true },
            "password":    { "type": "string", "minLength": 8, "x-password": true },
            "given_name":  { "type": "string", "minLength": 1, "maxLength": 200 },
            "family_name": { "type": "string", "minLength": 1, "maxLength": 200 }
        }
    }$$::json
)
ON CONFLICT (project_id, url) DO UPDATE SET payload = EXCLUDED.payload;

INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload)
VALUES (
    'proj-1',
    'https://example.test/user/v1/saas.user.schema.json',
    $${
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "x-auth-methods": { "password": { "enabled": true } },
        "required": ["email", "password", "display_name"],
        "properties": {
            "email":        { "type": "string", "format": "email", "maxLength": 320, "x-identifier": true },
            "password":     { "type": "string", "minLength": 8, "x-password": true },
            "display_name": { "type": "string", "minLength": 1, "maxLength": 100 },
            "company":      { "type": "string", "maxLength": 200 }
        }
    }$$::json
)
ON CONFLICT (project_id, url) DO UPDATE SET payload = EXCLUDED.payload;

-- 3. Register flow ------------------------------------------------------
-- credentials step → create_user on submit → "done" terminal (show).
INSERT INTO zitadel_nextgen.flow_definitions
    (project_id, id, name, schema_version, status, purposes, definition)
VALUES (
    'proj-1',
    'def-register',
    'standard-register',
    'v1',
    'active'::zitadel_nextgen.flow_definition_states,
    ARRAY['register']::zitadel_nextgen.flow_definition_purposes[],
    $${
        "user_schema": "https://example.test/user/v1/default.user.schema.json",
        "purposes": {"register": "credentials"},
        "audience": {},
        "steps": [
            {
                "name": "credentials",
                "fields": ["email", "username", "password", "given_name", "family_name"],
                "on_success": "create_user",
                "transitions": {
                    "submit": {"target": "done"}
                }
            },
            {
                "name": "done",
                "complete": "show"
            }
        ]
    }$$::jsonb
)
ON CONFLICT (project_id, id) DO UPDATE
    SET status = EXCLUDED.status,
        purposes = EXCLUDED.purposes,
        definition = EXCLUDED.definition,
        updated_at = NOW();

-- 4. Login flow ---------------------------------------------------------
-- credentials step dispatches identifier + password challenges (driven
-- by the schema's x-identifier / x-password annotations); on submit it
-- terminates at "done". The implicit user_not_found outcome from the
-- identifier challenge routes to "no_account".
INSERT INTO zitadel_nextgen.flow_definitions
    (project_id, id, name, schema_version, status, purposes, definition)
VALUES (
    'proj-1',
    'def-login',
    'standard-login',
    'v1',
    'active'::zitadel_nextgen.flow_definition_states,
    ARRAY['login']::zitadel_nextgen.flow_definition_purposes[],
    $${
        "user_schema": "https://example.test/user/v1/default.user.schema.json",
        "purposes": {"login": "credentials"},
        "audience": {},
        "steps": [
            {
                "name": "credentials",
                "fields": ["email", "password"],
                "transitions": {
                    "submit":          {"target": "done"},
                    "user_not_found":  {"target": "no_account"}
                }
            },
            {
                "name": "done",
                "complete": "show"
            },
            {
                "name": "no_account",
                "complete": "show"
            }
        ]
    }$$::jsonb
)
ON CONFLICT (project_id, id) DO UPDATE
    SET status = EXCLUDED.status,
        purposes = EXCLUDED.purposes,
        definition = EXCLUDED.definition,
        updated_at = NOW();

-- 5. Combined auth flow -----------------------------------------------
-- Supports both login AND register from the same entry point. The
-- credentials step verifies credentials via challenge dispatch; on
-- submit it terminates as a login; on user_not_found it routes to a
-- profile step that runs create_user.
--
-- Note: create_user reads fields from the current submit (not from
-- FlowState.CollectedData), so the profile step re-declares email +
-- password and the client must re-submit them. A real UI carries them
-- over transparently — for curl-based testing, just include them again.
INSERT INTO zitadel_nextgen.flow_definitions
    (project_id, id, name, schema_version, status, purposes, definition)
VALUES (
    'proj-1',
    'def-combined',
    'combined-auth',
    'v1',
    'active'::zitadel_nextgen.flow_definition_states,
    ARRAY['login', 'register']::zitadel_nextgen.flow_definition_purposes[],
    $${
        "user_schema": "https://example.test/user/v1/default.user.schema.json",
        "purposes": {"login": "credentials", "register": "credentials"},
        "audience": {},
        "steps": [
            {
                "name": "credentials",
                "fields": ["email", "password"],
                "transitions": {
                    "submit":         {"target": "done_login"},
                    "user_not_found": {"target": "profile"}
                }
            },
            {
                "name": "profile",
                "fields": ["email", "username", "password", "given_name", "family_name"],
                "on_success": "create_user",
                "transitions": {
                    "submit": {"target": "done_register"}
                }
            },
            {
                "name": "done_login",
                "complete": "show"
            },
            {
                "name": "done_register",
                "complete": "show"
            }
        ]
    }$$::jsonb
)
ON CONFLICT (project_id, id) DO UPDATE
    SET status = EXCLUDED.status,
        purposes = EXCLUDED.purposes,
        definition = EXCLUDED.definition,
        updated_at = NOW();

-- 6. Multi-step register ----------------------------------------------
-- Two collection steps before the user is materialized:
--   profile     – collect identity + names (no create_user yet)
--   set_password – collect password AND re-collect email; create_user
--                  runs here because it needs the identifier + password
--                  in the same submit (it reads in.Fields, not
--                  FlowState.CollectedData).
--
-- For curl-based testing, set_password's submit must include the email
-- value again. A real UI would prefill it from state.collected_data.
INSERT INTO zitadel_nextgen.flow_definitions
    (project_id, id, name, schema_version, status, purposes, definition)
VALUES (
    'proj-1',
    'def-register-multi',
    'multi-step-register',
    'v1',
    'active'::zitadel_nextgen.flow_definition_states,
    ARRAY['register']::zitadel_nextgen.flow_definition_purposes[],
    $${
        "user_schema": "https://example.test/user/v1/default.user.schema.json",
        "purposes": {"register": "profile"},
        "audience": {},
        "steps": [
            {
                "name": "profile",
                "fields": ["email", "username", "given_name", "family_name"],
                "transitions": {
                    "submit": {"target": "set_password"}
                }
            },
            {
                "name": "set_password",
                "fields": ["email", "password"],
                "on_success": "create_user",
                "transitions": {
                    "submit": {"target": "done"}
                }
            },
            {
                "name": "done",
                "complete": "show"
            }
        ]
    }$$::jsonb
)
ON CONFLICT (project_id, id) DO UPDATE
    SET status = EXCLUDED.status,
        purposes = EXCLUDED.purposes,
        definition = EXCLUDED.definition,
        updated_at = NOW();

-- 7. Enterprise login --------------------------------------------------
-- Three-stage login modelled on the visualizer's "Acme Corp SSO Login":
--   identify – collect email; identifier challenge dispatched here
--              (implicit user_not_found routes to the "denied" terminal)
--   signin   – collect password; password challenge dispatched here
--   consent  – action-only step (no fields), routes on accept/deny
--
-- sso_providers / audience are decorative for now — the state machine
-- parses them but the response is generated from transitions. Included
-- to exercise the full JSON shape end-to-end.
INSERT INTO zitadel_nextgen.flow_definitions
    (project_id, id, name, schema_version, status, purposes, definition)
VALUES (
    'proj-1',
    'def-enterprise-login',
    'enterprise-sso-login',
    'v1',
    'active'::zitadel_nextgen.flow_definition_states,
    ARRAY['login']::zitadel_nextgen.flow_definition_purposes[],
    $${
        "user_schema": "https://example.test/user/v1/default.user.schema.json",
        "purposes": {"login": "identify"},
        "audience": {"team_ids": ["team-acme"], "app_ids": ["app-dashboard"]},
        "steps": [
            {
                "name": "identify",
                "fields": ["email"],
                "sso_providers": [
                    {"id": "okta-acme",  "name": "Acme Okta",      "template": "okta"},
                    {"id": "azure-acme", "name": "Acme Azure AD", "template": "microsoft"}
                ],
                "transitions": {
                    "submit":         {"target": "signin"},
                    "user_not_found": {"target": "denied"}
                }
            },
            {
                "name": "signin",
                "fields": ["password"],
                "transitions": {
                    "submit": {"target": "consent"}
                }
            },
            {
                "name": "consent",
                "transitions": {
                    "accept": {"target": "done"},
                    "deny":   {"target": "denied"}
                }
            },
            {
                "name": "denied",
                "complete": "show"
            },
            {
                "name": "done",
                "complete": "redirect"
            }
        ]
    }$$::jsonb
)
ON CONFLICT (project_id, id) DO UPDATE
    SET status = EXCLUDED.status,
        purposes = EXCLUDED.purposes,
        definition = EXCLUDED.definition,
        updated_at = NOW();

-- 8. SaaS register ----------------------------------------------------
-- Single-step register against the saas_user schema. Demonstrates:
--   - alternate user schema (display_name / company instead of names)
--   - audience scoping to a single app
--   - decorative gates + sso_providers (parsed, not yet enforced)
INSERT INTO zitadel_nextgen.flow_definitions
    (project_id, id, name, schema_version, status, purposes, definition)
VALUES (
    'proj-1',
    'def-saas-register',
    'saas-register',
    'v1',
    'active'::zitadel_nextgen.flow_definition_states,
    ARRAY['register']::zitadel_nextgen.flow_definition_purposes[],
    $${
        "user_schema": "https://example.test/user/v1/saas.user.schema.json",
        "purposes": {"register": "profile"},
        "audience": {"app_ids": ["app-saas"]},
        "steps": [
            {
                "name": "profile",
                "fields": ["email", "password", "display_name", "company"],
                "on_success": "create_user",
                "gates": {
                    "captcha": {"kind": "captcha", "provider": "altcha"}
                },
                "sso_providers": [
                    {"id": "google-1", "name": "Google", "template": "google"},
                    {"id": "github-1", "name": "GitHub", "template": "github"}
                ],
                "transitions": {
                    "submit": {"target": "done"}
                }
            },
            {
                "name": "done",
                "complete": "show"
            }
        ]
    }$$::jsonb
)
ON CONFLICT (project_id, id) DO UPDATE
    SET status = EXCLUDED.status,
        purposes = EXCLUDED.purposes,
        definition = EXCLUDED.definition,
        updated_at = NOW();

COMMIT;
