import { describe, expect, it } from "vitest";

import { relativeDisplayPath } from "../../../../src/commands/setup/summary";

describe("relativeDisplayPath", () => {
  it("normalizes Windows paths for repository-style suffix matching", () => {
    const displayed = relativeDisplayPath(
      "C:\\repo",
      "C:\\repo\\.zitadel\\schemas\\default-human-user.json",
    );

    expect(displayed).toBe(".zitadel/schemas/default-human-user.json");
    expect(displayed.endsWith(".zitadel/schemas/default-human-user.json")).toBe(true);
  });

  it("does not strip a sibling path that merely shares the cwd prefix", () => {
    expect(relativeDisplayPath("C:\\repo", "C:\\repository\\file.json")).toBe(
      "C:/repository/file.json",
    );
  });
});
