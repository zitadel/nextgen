import type { OpenApiDocument } from "orval";
import { describe, expect, it } from "vitest";

import { absoluteDocsLinks, DOCS_ORIGIN } from "./docs-links";

describe("absoluteDocsLinks", () => {
  it("makes every docs link absolute, once, in shared and cyclic nodes", async () => {
    const shared: Record<string, unknown> = {
      description: "Claim it ([claim](/docs/concepts/project-team-user#claim)).",
    };
    shared.self = shared;
    const spec = {
      openapi: "3.1.0",
      info: { title: "t", version: "1", description: "See [deploy](/docs/guides/deploy)." },
      paths: {},
      components: { schemas: { A: shared, B: { allOf: [shared] } } },
      tags: [{ name: "x", description: "Elsewhere: [site](https://example.com/docs/)." }],
    } as unknown as OpenApiDocument;

    const out = (await absoluteDocsLinks(spec)) as unknown as typeof spec & Record<string, never>;
    const text = JSON.stringify(out, (key, value) => (key === "self" ? undefined : value));

    expect(text).not.toContain("](/docs/");
    expect(shared.description).toBe(
      `Claim it ([claim](${DOCS_ORIGIN}/docs/concepts/project-team-user#claim)).`,
    );
    expect(text).toContain(`](${DOCS_ORIGIN}/docs/guides/deploy)`);
    expect(text).toContain("](https://example.com/docs/)");
  });
});
