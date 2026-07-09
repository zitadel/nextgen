import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { SETUP_PRESETS, getDefaultLoginFlow } from "./defaults.js";
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

  // The meta-schema's whole purpose is editor validation of scaffolded flow
  // files — every preset's rendered flow, `$schema` pointer included, must
  // validate cleanly or setup ships files its own dialect spec rejects.
  describe("flow dialect matches what setup scaffolds", () => {
    const flowDialect = metaSchemaFiles().find((f) => f.name === "flow-definition.json");
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(flowDialect?.body ?? {});

    const scaffoldedFlow = (preset: string): Record<string, unknown> => ({
      $schema: FLOW_FILE_SCHEMA_REF,
      ...(getDefaultLoginFlow({ userSchemaUrl: "sch_test123", preset }) as Record<
        string,
        unknown
      >),
    });

    it.each(SETUP_PRESETS)("the %s preset's flow validates", (preset) => {
      validate(scaffoldedFlow(preset));
      expect(validate.errors ?? []).toEqual([]);
    });

    it("rejects the stale map-of-actions dialect", () => {
      const flow = scaffoldedFlow("password-first");
      const steps = flow.steps as Array<{ actions?: unknown }>;
      steps[0].actions = { submit: { primary: true } };
      expect(validate(flow)).toBe(false);
    });
  });
});
