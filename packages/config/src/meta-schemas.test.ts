import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { getDefaultLoginFlow, SETUP_PRESETS } from "./defaults.js";
import { FLOW_FILE_SCHEMA_REF, META_SCHEMA_DIR, metaSchemaFiles } from "./meta-schemas.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamDir = join(packageRoot, "../..", "api/openapi/endpoints/schemas");

describe("meta-schemas", () => {
  it("exposes the three dialect files", () => {
    expect(metaSchemaFiles().map((f) => f.name)).toEqual([
      "flow-definition.json",
      "user-schema.json",
      "user-property.json",
    ]);
  });

  it("the flow $schema ref resolves from .zitadel/flows/ into the meta dir", () => {
    expect(META_SCHEMA_DIR).toBe(".zitadel/meta");
    expect(join(".zitadel/flows", FLOW_FILE_SCHEMA_REF)).toBe(
      join(META_SCHEMA_DIR, "flow-definition.json"),
    );
  });

  // Drift audit: the committed copies must stay identical to the source the
  // server embeds. Skipped outside the monorepo (published-package CI).
  it.skipIf(!existsSync(upstreamDir))("committed copies match api/openapi", () => {
    for (const file of metaSchemaFiles()) {
      const upstream = JSON.parse(readFileSync(join(upstreamDir, file.name), "utf8")) as object;
      expect(file.body, `${file.name} drifted from api/openapi/endpoints/schemas`).toEqual(
        upstream,
      );
    }
  });

  // The whole point of shipping the meta-schema: it must accept the exact
  // files that carry the `$schema` pointer at it. A dialect drift here means
  // editors flag every scaffolded flow as invalid.
  it("validates every scaffolded preset flow", () => {
    const ajv = new Ajv2020({ strict: false });
    const flowSchema = metaSchemaFiles().find((f) => f.name === "flow-definition.json");
    const check = ajv.compile(flowSchema?.body as object);
    for (const preset of SETUP_PRESETS) {
      const flow = getDefaultLoginFlow({ preset, userSchemaUrl: "sch_TEST" });
      expect(check(flow), `${preset}: ${JSON.stringify(check.errors)}`).toBe(true);
    }
  });

  it("accepts an explicit `action: null` transition, as the OpenAPI contract does", () => {
    const ajv = new Ajv2020({ strict: false });
    const flowSchema = metaSchemaFiles().find((f) => f.name === "flow-definition.json");
    const check = ajv.compile(flowSchema?.body as object);
    const flow = getDefaultLoginFlow({ userSchemaUrl: "sch_TEST" }) as unknown as {
      steps: Array<{
        transitions?: Record<string, { target: string; action?: string | null }>;
      }>;
    };
    const step = flow.steps.find((s) => s.transitions && Object.keys(s.transitions).length > 0);
    const transition = Object.values(step?.transitions ?? {})[0];
    if (!transition) throw new Error("fixture flow has no transitions");
    // `action: null` means "current flow" — the wire contract marks the enum
    // nullable, so the editor-facing dialect must not flag it.
    transition.action = null;
    expect(check(flow), JSON.stringify(check.errors)).toBe(true);
    // The enum still constrains real values.
    (transition as { action: unknown }).action = "warp";
    expect(check(flow)).toBe(false);
  });

  it("rejects the pre-array actions dialect and unknown keys", () => {
    const ajv = new Ajv2020({ strict: false });
    const flowSchema = metaSchemaFiles().find((f) => f.name === "flow-definition.json");
    const check = ajv.compile(flowSchema?.body as object);
    const flow = getDefaultLoginFlow({ userSchemaUrl: "sch_TEST" }) as unknown as {
      steps: Array<{ actions?: unknown }>;
    };
    // Old dialect: actions keyed by name instead of an ordered array.
    const [entry] = flow.steps;
    if (entry) {
      entry.actions = { submit: { primary: true } };
    }
    expect(check(flow)).toBe(false);

    const withUnknown = {
      ...getDefaultLoginFlow({ userSchemaUrl: "sch_TEST" }),
      not_a_flow_key: true,
    };
    expect(check(withUnknown)).toBe(false);
  });
});
