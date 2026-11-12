import { describe, expect, it } from "vitest";

import { BreakingChangesBanner } from "@/lib/zitadel-upgrade";

describe("BreakingChangesBanner.render", () => {
  it("lists each change, then where the release notes are", () => {
    const banner = new BreakingChangesBanner([
      { version: "1.1.0", note: "renamed a flag" },
      { version: "1.2.0", note: "dropped a command" },
    ]).render();

    expect(banner).toContain("Breaking changes on the way:");
    expect(banner).toContain("1.1.0");
    expect(banner).toContain("dropped a command");
    expect(banner).toContain("Release notes: ");
  });

  it("only points at the release notes when nothing breaks", () => {
    const banner = new BreakingChangesBanner([]).render();

    expect(banner).not.toContain("Breaking changes on the way:");
    expect(banner).toContain("Release notes: ");
  });

  it("spells out control characters in a version or a note", () => {
    const banner = new BreakingChangesBanner([
      { version: "1.1.0", note: "wiped\u001b[2J the screen" },
    ]).render();

    expect(banner).not.toContain("\u001b[2J");
  });
});
