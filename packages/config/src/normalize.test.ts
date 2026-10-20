import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FLOW_STEP_DEFAULTS,
  IDP_CONNECTION_DEFAULTS,
  normalizeFlowBody,
  normalizeIdpBody,
  normalizeSchemaBody,
  STEP_ACTION_DEFAULTS,
  USER_PROPERTY_DEFAULTS,
} from "./normalize";

/**
 * A meta-schema from the source tree. The default constants ship in the
 * package, but their values are spec facts owned by api/openapi: drift means
 * the meta-schema changed and the normalizer must follow.
 */
function metaSchema(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(__dirname, "../../../api/openapi/endpoints/schemas", name), "utf8"),
  ) as Record<string, unknown>;
}

/** Every `default` the given meta-schema properties declare, by property name. */
function declaredDefaults(
  properties: Record<string, { default?: unknown }> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties ?? {})
      .filter(([, property]) => "default" in property)
      .map(([name, property]) => [name, property.default]),
  );
}

describe("normalizeFlowBody", () => {
  it("drops an empty audience in both wire shapes", () => {
    expect(normalizeFlowBody({ name: "login", audience: {} })).toEqual({ name: "login" });
    expect(normalizeFlowBody({ name: "login", audience: { team_ids: [], app_ids: [] } })).toEqual({
      name: "login",
    });
    expect(normalizeFlowBody({ name: "login", audience: { team_ids: null } })).toEqual({
      name: "login",
    });
  });

  it("keeps a non-empty audience verbatim", () => {
    const body = { name: "login", audience: { team_ids: ["team_1"] } };
    expect(normalizeFlowBody(body)).toEqual(body);
  });

  it("keeps an audience with unknown keys", () => {
    const body = { name: "login", audience: { org_ids: [] } };
    expect(normalizeFlowBody(body)).toEqual(body);
  });

  it("strips detail-envelope keys", () => {
    expect(
      normalizeFlowBody({
        id: "flow_1",
        project_id: "proj_1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        name: "login",
      }),
    ).toEqual({ name: "login" });
  });

  it("strips the local-only $schema editor pointer", () => {
    expect(normalizeFlowBody({ $schema: "../meta/flow-definition.json", name: "login" })).toEqual({
      name: "login",
    });
  });

  it("does not mutate its input and is idempotent", () => {
    const body = { name: "login", audience: {} };
    const once = normalizeFlowBody(body);
    expect(body).toEqual({ name: "login", audience: {} });
    expect(normalizeFlowBody(once)).toEqual(once);
  });

  it("strips the step and action defaults a step spells out", () => {
    const body = {
      name: "login",
      steps: [
        {
          name: "identifier",
          fields: [],
          gates: {},
          sso_providers: [],
          actions: [
            { name: "submit", kind: "submit", primary: true },
            { name: "register", kind: "navigate", primary: false },
          ],
        },
        { name: "done", actions: [] },
      ],
    };

    expect(normalizeFlowBody(body)).toEqual({
      name: "login",
      steps: [
        {
          name: "identifier",
          actions: [
            { name: "submit", kind: "submit", primary: true },
            { name: "register", kind: "navigate" },
          ],
        },
        { name: "done" },
      ],
    });
    expect(body.steps[0]?.actions[1]).toHaveProperty("primary", false);
  });

  it("keeps step values that are not the default", () => {
    const step = { name: "identifier", fields: ["email"], sso_providers: ["google"] };

    expect(normalizeFlowBody({ steps: [step] })).toEqual({ steps: [step] });
  });

  it("matches the defaults declared by the flow-definition meta-schema", () => {
    const defs = metaSchema("flow-definition.json").$defs as Record<
      string,
      { properties: Record<string, { default?: unknown }> }
    >;

    expect(declaredDefaults(defs.FlowDefinitionStep?.properties)).toEqual(FLOW_STEP_DEFAULTS);
    expect(declaredDefaults(defs.StepAction?.properties)).toEqual(STEP_ACTION_DEFAULTS);
  });
});

describe("normalizeIdpBody", () => {
  const authored = {
    $schema: "../meta/idp-connection.json",
    slug: "google",
    protocol: "oidc",
    display_name: "Google",
    oidc: {
      issuer: "https://accounts.google.com",
      client_id: "${{ GOOGLE_CLIENT_ID }}",
      client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      scopes: ["openid", "profile", "email"],
    },
  };

  it("reads a stored connection that spells out the defaults as the file that leaves them out", () => {
    const stored = {
      slug: "google",
      protocol: "oidc",
      display_name: "Google",
      provisioning: { creation: "auto" },
      oidc: {
        ...authored.oidc,
        id_token_mapping: false,
        pkce_enabled: true,
        token_endpoint_auth_method: "client_secret_basic",
      },
    };

    expect(normalizeIdpBody(stored)).toEqual(normalizeIdpBody(authored));
  });

  it("keeps a value that is not the default", () => {
    const body = {
      ...authored,
      provisioning: { creation: "disabled" },
      oidc: {
        ...authored.oidc,
        pkce_enabled: false,
        token_endpoint_auth_method: "client_secret_post",
      },
    };
    const { $schema: _pointer, ...expected } = body;

    expect(normalizeIdpBody(body)).toEqual(expected);
  });

  it("keeps the scopes, whose default is only an editor prefill", () => {
    expect(normalizeIdpBody(authored)).toHaveProperty("oidc.scopes", [
      "openid",
      "profile",
      "email",
    ]);
  });

  it("does not mutate its input and is idempotent", () => {
    const body = structuredClone({ ...authored, oidc: { ...authored.oidc, pkce_enabled: true } });
    const once = normalizeIdpBody(body);

    expect(body.oidc.pkce_enabled).toBe(true);
    expect(normalizeIdpBody(once)).toEqual(once);
  });

  it("matches the defaults declared by the connection meta-schema", () => {
    const properties = metaSchema("idp-connection.json").properties as Record<
      string,
      { properties?: Record<string, { default?: unknown }> }
    >;
    const { scopes: _prefill, ...oidc } = declaredDefaults(properties.oidc?.properties);

    expect({
      oidc,
      provisioning: declaredDefaults(properties.provisioning?.properties),
    }).toEqual(IDP_CONNECTION_DEFAULTS);
  });
});

describe("normalizeSchemaBody", () => {
  it("strips exact meta-schema defaults from properties", () => {
    const normalized = normalizeSchemaBody({
      objectType: "human-user",
      properties: {
        email: { type: "string", "x-audit": false },
        givenName: { type: "string" },
      },
    });
    expect(normalized).toEqual({
      objectType: "human-user",
      properties: {
        email: { type: "string" },
        givenName: { type: "string" },
      },
    });
  });

  // A leaf of an object property normalizes the same way a top-level one
  // does, or its defaults would read as a permanent diff.
  it("strips defaults from nested properties too", () => {
    const normalized = normalizeSchemaBody({
      properties: {
        address: {
          type: "object",
          "x-audit": false,
          properties: {
            street: { type: "string", "x-audit": false },
            city: { type: "string", "x-audit": true },
          },
        },
      },
    });
    expect(normalized).toEqual({
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string", "x-audit": true },
          },
        },
      },
    });
  });

  it("keeps non-default values", () => {
    const body = {
      properties: {
        email: { type: "string", "x-audit": true },
      },
    };
    expect(normalizeSchemaBody(body)).toEqual(body);
  });

  it("keeps native keywords the dialect declares no default for", () => {
    const body = { properties: { secret: { type: "string", writeOnly: false } } };
    expect(normalizeSchemaBody(body)).toEqual(body);
  });

  it("keeps $id and schema-level fields untouched", () => {
    const body = {
      $id: "https://example.test/schemas/human.json",
      objectType: "human-user",
      "x-auth-methods": { password: { enabled: true } },
      required: ["email"],
      properties: { email: { type: "string" } },
    };
    expect(normalizeSchemaBody(body)).toEqual(body);
  });

  it("does not mutate its input and is idempotent", () => {
    const body = { properties: { email: { type: "string", "x-audit": false } } };
    const once = normalizeSchemaBody(body);
    expect(body).toEqual({ properties: { email: { type: "string", "x-audit": false } } });
    expect(normalizeSchemaBody(once)).toEqual(once);
  });

  // The caller hands the same parsed object to the upload payload, so a
  // descent that stripped in place would delete nested defaults out of what
  // gets published. The flat test above never reaches the recursion.
  it("does not mutate a nested input and is idempotent", () => {
    const nested = () => ({
      properties: {
        address: {
          type: "object",
          properties: { street: { type: "string", "x-audit": false } },
        },
      },
    });
    const body = nested();
    const once = normalizeSchemaBody(body);
    expect(body).toEqual(nested());
    expect(normalizeSchemaBody(once)).toEqual(once);
  });

  it("matches the defaults declared by the user-property meta-schema", () => {
    // Source-tree pin: the constant ships in the package, but its values are
    // spec facts owned by api/openapi. Drift here means the meta-schema
    // changed and the normalizer must follow.
    const metaSchema = JSON.parse(
      readFileSync(
        join(__dirname, "../../../api/openapi/endpoints/schemas/user-property.json"),
        "utf8",
      ),
    ) as { properties: Record<string, { default?: unknown }> };

    for (const [key, defaultValue] of Object.entries(USER_PROPERTY_DEFAULTS)) {
      expect(metaSchema.properties[key]?.default).toBe(defaultValue);
    }
  });
});
