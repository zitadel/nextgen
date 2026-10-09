import { describe, expect, it } from "vitest";

import { flowsReadmeContent, schemasReadmeContent } from "./readmes";

// Regression guard for the scaffolded README content: a bad merge once
// shipped `.zitadel/flows/README.md` with its "## Presets" section
// duplicated verbatim, and nothing caught it because the files are read
// straight from disk.
describe.each([
  ["flows", flowsReadmeContent],
  ["schemas", schemasReadmeContent],
])("%s README content", (_name, content) => {
  it("is non-empty markdown with a top-level heading", () => {
    expect(content()).toMatch(/^# /);
  });

  it("has no duplicated section headings", () => {
    const headings = content()
      .split("\n")
      .filter((line) => line.startsWith("## "));
    expect(headings).toEqual([...new Set(headings)]);
  });
});
