import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inlineOpenApi } from "./inline-openapi";

function spec(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "inline-openapi-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return join(dir, "openapi.yaml");
}

describe("inlineOpenApi", () => {
  it("inlines file refs, dropping a ref's siblings and $schema/$id like orval", () => {
    const doc = inlineOpenApi(
      spec({
        "openapi.yaml":
          "openapi: 3.1.0\npaths:\n  /a:\n    $ref: a.yaml\n    description: dropped\n",
        "a.yaml": 'get:\n  responses:\n    "200":\n      $ref: b.yaml\n',
        "b.yaml": "$schema: https://json-schema.org/draft/2020-12/schema\n$id: b\ndescription: B\n",
      }),
    );

    expect(doc.paths).toEqual({ "/a": { get: { responses: { "200": { description: "B" } } } } });
    expect(doc.components).toBeUndefined();
  });

  it("keeps a recursive schema as a component named after its title", () => {
    const doc = inlineOpenApi(
      spec({
        "openapi.yaml": [
          "openapi: 3.1.0",
          "components:",
          "  securitySchemes:",
          "    s:",
          "      type: http",
          "      scheme: bearer",
          "  schemas:",
          "    Root:",
          "      $ref: node.yaml",
          "",
        ].join("\n"),
        "node.yaml": "title: Node\ntype: object\nadditionalProperties:\n  $ref: node.yaml\n",
      }),
    );

    const ref = { $ref: "#/components/schemas/Node" };
    expect(doc.components).toEqual({
      securitySchemes: { s: { type: "http", scheme: "bearer" } },
      schemas: {
        // The first use stays inline, as orval inlines it; only the ref back
        // into the file goes through the component.
        Root: { title: "Node", type: "object", additionalProperties: ref },
        Node: { title: "Node", type: "object", additionalProperties: ref },
      },
    });
  });

  it("names a recursive schema without a usable title after its file", () => {
    const doc = inlineOpenApi(
      spec({
        "openapi.yaml":
          "openapi: 3.1.0\ncomponents:\n  schemas:\n    Root:\n      $ref: tree-node.yaml\n",
        "tree-node.yaml": "title: Tree node\nitems:\n  $ref: tree-node.yaml\n",
      }),
    );

    expect(doc.components).toMatchObject({
      schemas: { "tree-node": { items: { $ref: "#/components/schemas/tree-node" } } },
    });
  });
});
