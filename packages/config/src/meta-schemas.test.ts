import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
});
