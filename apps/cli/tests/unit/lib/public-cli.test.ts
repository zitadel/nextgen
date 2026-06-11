import { describe, expect, it } from "vitest";

import {
  normalizePublicCliCommand,
  npmDistTagForCliVersion,
  publicCliCommand,
} from "../../../src/lib/public-cli";

describe("public CLI command formatting", () => {
  it("uses the prerelease segment as the npm dist-tag", () => {
    expect(npmDistTagForCliVersion("0.1.0-alpha.1")).toBe("alpha");
    expect(publicCliCommand("start", "0.1.0-alpha.1")).toBe("npx @zitadel/cli@alpha start");
  });

  it("uses latest for stable versions", () => {
    expect(npmDistTagForCliVersion("0.1.0")).toBe("latest");
    expect(publicCliCommand("start", "0.1.0")).toBe("npx @zitadel/cli@latest start");
  });

  it("preserves command args exactly", () => {
    expect(publicCliCommand("setup --server local", "0.1.0-alpha.1")).toBe(
      "npx @zitadel/cli@alpha setup --server local",
    );
  });

  it("normalizes bare zitadel follow-ups and leaves other commands alone", () => {
    expect(normalizePublicCliCommand("zitadel doctor --fix", "0.1.0-alpha.1")).toBe(
      "npx @zitadel/cli@alpha doctor --fix",
    );
    expect(normalizePublicCliCommand("npm install", "0.1.0-alpha.1")).toBe("npm install");
    expect(normalizePublicCliCommand("docker version", "0.1.0-alpha.1")).toBe("docker version");
  });
});
