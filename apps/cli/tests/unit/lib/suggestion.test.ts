import { describe, expect, it } from "vitest";

import { environmentSelectorSuffix } from "../../../src/lib/oclif/environment-flags";
import {
  inShell,
  projectCommand,
  shellCommand,
  unscopedCommand,
} from "../../../src/lib/suggestion";

const VERSION = "1.0.0-alpha.25";

describe("projectCommand", () => {
  it("appends the run's selector", () => {
    const selector = environmentSelectorSuffix({ envName: "production" });

    expect(projectCommand("variables list", selector, VERSION)).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 variables list --env production",
    );
  });

  it("appends nothing for a run that named no environment", () => {
    expect(projectCommand("doctor", environmentSelectorSuffix({}), VERSION)).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 doctor",
    );
  });

  it("carries an env file and a server together", () => {
    const selector = environmentSelectorSuffix({ envFile: ".env.ci", server: "https://a.example" });

    expect(projectCommand("claim", selector, VERSION)).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 claim --env-file .env.ci --server https://a.example",
    );
  });
});

describe("unscopedCommand", () => {
  it("is the public npx form when the version is known", () => {
    expect(unscopedCommand("start", VERSION)).toBe("npx @zitadel/cli@1.0.0-alpha.25 start");
  });

  it("is the bare zitadel form, for the envelope to rewrite, without one", () => {
    expect(unscopedCommand("setup")).toBe("zitadel setup");
  });
});

describe("shellCommand", () => {
  it("is suggested exactly as written", () => {
    expect(shellCommand("npm install @zitadel/cli@alpha")).toBe("npm install @zitadel/cli@alpha");
  });
});

describe("inShell", () => {
  it("puts a pipe before the command", () => {
    expect(inShell(unscopedCommand("setup"), { before: "printf '%s' \"$S\" | " })).toBe(
      "printf '%s' \"$S\" | zitadel setup",
    );
  });

  it("puts a redirection after the selector", () => {
    const command = projectCommand(
      "variables set TOKEN --secret",
      environmentSelectorSuffix({ envName: "ci" }),
      VERSION,
    );

    expect(inShell(command, { after: " < value.txt" })).toBe(
      "npx @zitadel/cli@1.0.0-alpha.25 variables set TOKEN --secret --env ci < value.txt",
    );
  });
});
