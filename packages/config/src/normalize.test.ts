import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeFlowBody,
  normalizeSchemaBody,
  USER_PROPERTY_DEFAULTS,
} from "./normalize";

describe("normalizeFlowBody", () => {
  it("drops an empty audience in both wire shapes", () => {
    expect(normalizeFlowBody({ name: "login", audience: {} })).toEqual({ name: "login" });
    expect(
      normalizeFlowBody({ name: "login", audience: { team_ids: [], app_ids: [] } }),
    ).toEqual({ name: "login" });
    expect(
      normalizeFlowBody({ name: "login", audience: { team_ids: null } }),
    ).toEqual({ name: "login" });
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
        schema_uri: "https://example.test/flow.json",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        name: "login",
      }),
    ).toEqual({ name: "login" });
  });

  it("strips the local-only $schema editor pointer", () => {
    expect(
      normalizeFlowBody({ $schema: "../meta/flow-definition.json", name: "login" }),
    ).toEqual({ name: "login" });
  });

  it("does not mutate its input and is idempotent", () => {
    const body = { name: "login", audience: {} };
    const once = normalizeFlowBody(body);
    expect(body).toEqual({ name: "login", audience: {} });
    expect(normalizeFlowBody(once)).toEqual(once);
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
