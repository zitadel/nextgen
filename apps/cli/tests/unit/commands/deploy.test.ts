import { describe, expect, it } from "vitest";

import { abbreviate, deployed, liveOn, noPrimaryOriginError } from "../../../src/commands/deploy";
import { environmentSelectorSuffix } from "../../../src/lib/oclif/environment-flags";
import { cliVersion, expectedPublicCliCommand } from "../../helpers/run-cli";

const HASH = `sha256:${"a".repeat(64)}`;

describe("the line a deploy closes on", () => {
  it("says what was deployed, not what it is called", () => {
    expect(deployed(3)).toBe("Deployed 3 resources");
  });

  it("counts one resource as one", () => {
    expect(deployed(1)).toBe("Deployed 1 resource");
  });
});

describe("where a release went", () => {
  it("names the one origin it landed on", () => {
    expect(liveOn(HASH, ["http://localhost:3000"])).toBe(
      "Release sha256:aaaaaaaaaaaa is now live on http://localhost:3000.",
    );
  });

  // A bullet list of one line is not a list, so several origins are named in
  // the sentence rather than under it.
  it("joins several origins into the sentence", () => {
    expect(liveOn(HASH, ["https://a.example.com", "https://b.example.com"])).toContain(
      "live on https://a.example.com and https://b.example.com.",
    );
  });

  it("lists three with commas and a final and", () => {
    expect(liveOn(HASH, ["a", "b", "c"])).toContain("live on a, b and c.");
  });

  it("says nothing about where when it landed nowhere", () => {
    expect(liveOn(HASH, [])).toBe("Release sha256:aaaaaaaaaaaa is now live.");
  });

  // The full digest identifies the release to a machine, and the envelope is
  // where a machine reads it.
  it("never spells the whole digest at a person", () => {
    expect(liveOn(HASH, ["http://localhost:3000"])).not.toContain("a".repeat(64));
  });

  it("stays inside the box it is drawn in", () => {
    expect(liveOn(HASH, ["http://localhost:3000"]).length).toBeLessThanOrEqual(73);
  });
});

describe("abbreviate", () => {
  // `Deployed sha256:<64 hex>` is wider than a closing line may be, so the
  // whole sentence was thrown away and replaced by "Done".
  it("cuts a content hash to a closing line a person can read", () => {
    expect(abbreviate(`sha256:${"a".repeat(64)}`)).toBe("sha256:aaaaaaaaaaaa");
  });

  it("keeps the algorithm, so what was cut is still named", () => {
    expect(abbreviate(`sha256:${"0123456789abcdef".repeat(4)}`)).toBe("sha256:0123456789ab");
  });

  it("leaves a hash short enough to read as it is", () => {
    expect(abbreviate("sha256:abc")).toBe("sha256:abc");
  });

  it("cuts a bare digest that names no algorithm", () => {
    expect(abbreviate("a".repeat(64))).toBe("aaaaaaaaaaaa");
  });
});

const ISSUER = "http://localhost:3000";
const PREVIEW_ISSUER = [{ pattern: ISSUER, kind: "preview" }];

function errorFor(
  input: Partial<Parameters<typeof noPrimaryOriginError>[0]>,
): ReturnType<typeof noPrimaryOriginError> {
  return noPrimaryOriginError({
    origins: [],
    issuer: ISSUER,
    setupProject: true,
    selector: environmentSelectorSuffix({}),
    cliVersion: cliVersion.version,
    ...input,
  });
}

describe("noPrimaryOriginError", () => {
  it("is a validation error", () => {
    expect(errorFor({}).code).toBe("E_VALIDATION");
  });

  it("suggests doctor --fix for setup's project holding its issuer as a preview origin", () => {
    const error = errorFor({
      origins: PREVIEW_ISSUER,
      selector: environmentSelectorSuffix({ cwd: "web" }),
    });

    expect(error.nextCommands).toEqual([expectedPublicCliCommand("doctor --fix --cwd web")]);
  });

  it("says why adding the preview issuer as primary does not work", () => {
    const error = errorFor({ origins: PREVIEW_ISSUER });

    expect(error.hint).toContain(`holds its issuer ${ISSUER} as a preview origin`);
  });

  it("suggests removing and re-adding the issuer for a project doctor does not repair", () => {
    const error = errorFor({
      origins: PREVIEW_ISSUER,
      setupProject: false,
      selector: environmentSelectorSuffix({ envName: "staging" }),
    });

    expect(error.nextCommands).toEqual([
      expectedPublicCliCommand(`origin rm ${ISSUER} --force --env staging`),
      expectedPublicCliCommand(`origin add ${ISSUER} --kind primary --env staging`),
    ]);
  });

  it("suggests adding the issuer as primary when the project does not hold it", () => {
    const error = errorFor({
      origins: [{ pattern: "https://*-acme.vercel.app", kind: "preview" }],
    });

    expect(error.nextCommands).toEqual([
      expectedPublicCliCommand(`origin add ${ISSUER} --kind primary`),
    ]);
  });

  it("adds the issuer as its origin, without a trailing slash", () => {
    const error = errorFor({ issuer: `${ISSUER}/` });

    expect(error.nextCommands).toEqual([
      expectedPublicCliCommand(`origin add ${ISSUER} --kind primary`),
    ]);
  });

  it("names origin add with a URL to fill in when no issuer resolves", () => {
    const error = errorFor({
      issuer: undefined,
      selector: environmentSelectorSuffix({ envName: "prod" }),
    });

    expect(error.hint).toContain(
      expectedPublicCliCommand("origin add <url> --kind primary --env prod"),
    );
  });

  it("suggests origin list when no issuer resolves", () => {
    const error = errorFor({ issuer: undefined });

    expect(error.nextCommands).toEqual([expectedPublicCliCommand("origin list")]);
  });
});
