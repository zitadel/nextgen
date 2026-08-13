import { describe, expect, it } from "vitest";

import {
  normalizePublicCliCommand,
  normalizePublicCliProse,
  npmDistTagForCliVersion,
  npmSelectorForCliVersion,
  publicCliCommand,
} from "../../../src/lib/public-cli";

describe("public CLI command formatting", () => {
  it("keeps dist-tag detection separate from alpha follow-up selectors", () => {
    expect(npmDistTagForCliVersion("0.1.0-alpha.1")).toBe("alpha");
    expect(npmSelectorForCliVersion("0.1.0-alpha.1")).toBe("0.1.0-alpha.1");
    expect(publicCliCommand("start", "0.1.0-alpha.1")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 start",
    );
  });

  it("uses latest for stable versions", () => {
    expect(npmDistTagForCliVersion("0.1.0")).toBe("latest");
    expect(publicCliCommand("start", "0.1.0")).toBe("npx @zitadel/cli@latest start");
  });

  it("preserves command args exactly", () => {
    expect(publicCliCommand("setup --server local", "0.1.0-alpha.1")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 setup --server local",
    );
  });

  it("keeps non-alpha prereleases on their dist-tag", () => {
    expect(publicCliCommand("start", "0.1.0-beta.2")).toBe(
      "npx @zitadel/cli@beta start",
    );
  });

  it("normalizes bare zitadel follow-ups and leaves other commands alone", () => {
    expect(normalizePublicCliCommand("zitadel doctor --fix", "0.1.0-alpha.1")).toBe(
      "npx @zitadel/cli@0.1.0-alpha.1 doctor --fix",
    );
    expect(normalizePublicCliCommand("npm install", "0.1.0-alpha.1")).toBe("npm install");
    expect(normalizePublicCliCommand("docker version", "0.1.0-alpha.1")).toBe("docker version");
  });
});

describe("normalizePublicCliProse", () => {
  it("rewrites inline code spans to the public npx form", () => {
    expect(
      normalizePublicCliProse("2. `zitadel plan` — validates the template.", "0.1.0-alpha.1"),
    ).toBe("2. `npx @zitadel/cli@0.1.0-alpha.1 plan` — validates the template.");
    expect(
      normalizePublicCliProse(
        "Start over with `zitadel branding eject --design <name>`.",
        "0.1.0-alpha.1",
      ),
    ).toBe(
      "Start over with `npx @zitadel/cli@0.1.0-alpha.1 branding eject --design <name>`.",
    );
  });

  it("rewrites a bare `zitadel` span and fenced-block command lines", () => {
    expect(normalizePublicCliProse("run `zitadel` for help", "0.1.0-alpha.1")).toBe(
      "run `npx @zitadel/cli@0.1.0-alpha.1` for help",
    );
    expect(normalizePublicCliProse("```sh\nzitadel apply\n```", "0.1.0-alpha.1")).toBe(
      "```sh\nnpx @zitadel/cli@0.1.0-alpha.1 apply\n```",
    );
  });

  it("leaves file names and unrelated prose untouched", () => {
    const prose = "Edit `zitadel.json` and `.zitadel/branding/branding.json`; `zitadel.db` stays.";
    expect(normalizePublicCliProse(prose, "0.1.0-alpha.1")).toBe(prose);
    expect(normalizePublicCliProse("`npm install` then `git push`", "0.1.0-alpha.1")).toBe(
      "`npm install` then `git push`",
    );
  });
});
