import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Capture = (command: string, args: string[]) => Promise<{ stdout: string }>;

type ReleaseDistTagsModule = {
  findPrereleaseOnlyPackages: (
    names: string[],
    tag: string,
    options: { capture: Capture },
  ) => Promise<string[]>;
  isPrereleaseOnly: (versions: string[], tag: string) => boolean;
  prereleaseIdentifier: (version: string) => string | undefined;
  prereleaseOnlyMessage: (names: string[], tag: string) => string;
  readPrereleaseTag: (root: string) => Promise<string | undefined>;
  readPublishedVersions: (name: string, options: { capture: Capture }) => Promise<string[]>;
};

let distTags: ReleaseDistTagsModule;
const tempDirs: string[] = [];

beforeAll(async () => {
  distTags = (await import(
    new URL("../../../../../scripts/release-dist-tags.mjs", import.meta.url).href
  )) as ReleaseDistTagsModule;
});

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A fake `npm view <name> versions --json`: versions per package, E404 when absent. */
function npmView(registry: Record<string, string[] | string>): Capture {
  return async (_command, args) => {
    const name = args[1] ?? "";
    const versions = registry[name];
    if (versions === undefined) {
      throw Object.assign(new Error(`npm view ${name} failed with exit 1`), {
        stdout: JSON.stringify({ error: { code: "E404", summary: "Not Found" } }),
      });
    }
    return { stdout: JSON.stringify(versions) };
  };
}

describe("release dist-tags preflight", () => {
  it("reads the prerelease identifier of a version", () => {
    expect(distTags.prereleaseIdentifier("1.0.0-alpha.25")).toBe("alpha");
    expect(distTags.prereleaseIdentifier("0.0.0-oidc-bootstrap.0")).toBe("oidc-bootstrap");
    expect(distTags.prereleaseIdentifier("1.0.0-alpha.25+build.7")).toBe("alpha");
    expect(distTags.prereleaseIdentifier("0.0.0")).toBeUndefined();
  });

  it("flags a package whose every version is a prerelease of the tag", () => {
    expect(distTags.isPrereleaseOnly(["0.1.0-alpha.11", "1.0.0-alpha.25"], "alpha")).toBe(true);
    // Any other version keeps Changesets on the prerelease tag.
    expect(distTags.isPrereleaseOnly(["0.0.0", "1.0.0-alpha.25"], "alpha")).toBe(false);
    expect(distTags.isPrereleaseOnly(["0.0.0-oidc-bootstrap.0", "1.0.0-alpha.25"], "alpha")).toBe(
      false,
    );
    // Never published: the first publish already goes to the prerelease tag.
    expect(distTags.isPrereleaseOnly([], "alpha")).toBe(false);
  });

  it("finds the packages changeset publish would put on latest", async () => {
    const capture = npmView({
      "@zitadel/sdk-react": ["0.0.0", "1.0.0-alpha.25"],
      "@zitadel/sdk-solid": ["0.1.0-alpha.11", "1.0.0-alpha.25"],
      "@zitadel/server": ["0.0.0-oidc-bootstrap.0", "1.0.0-alpha.25"],
      "@zitadel/sdk-qwik": "1.0.0-alpha.25",
    });

    const stuck = await distTags.findPrereleaseOnlyPackages(
      [
        "@zitadel/sdk-react",
        "@zitadel/sdk-solid",
        "@zitadel/server",
        "@zitadel/sdk-qwik",
        "@zitadel/not-yet-published",
      ],
      "alpha",
      { capture },
    );

    expect(stuck).toEqual(["@zitadel/sdk-solid", "@zitadel/sdk-qwik"]);
  });

  it("rethrows registry failures other than a missing package", async () => {
    const capture: Capture = async () => {
      throw Object.assign(new Error("npm view failed with exit 1"), {
        stdout: JSON.stringify({ error: { code: "ETIMEDOUT" } }),
      });
    };

    await expect(distTags.readPublishedVersions("@zitadel/sdk-solid", { capture })).rejects.toThrow(
      "npm view failed",
    );
  });

  it("names the packages and gives a bootstrap command for each", () => {
    const message = distTags.prereleaseOnlyMessage(
      ["@zitadel/sdk-solid", "@zitadel/sdk-svelte"],
      "alpha",
    );

    expect(message).toContain("@zitadel/sdk-solid, @zitadel/sdk-svelte only have `alpha`");
    expect(message.match(/npm publish --access public --tag bootstrap/g)).toHaveLength(2);
    expect(message).toContain('"@zitadel/sdk-svelte" "@zitadel/sdk-svelte"');
  });

  it("reads the prerelease tag only in pre mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-dist-tags-"));
    tempDirs.push(root);
    expect(await distTags.readPrereleaseTag(root)).toBeUndefined();

    await mkdir(join(root, ".changeset"));
    await writeFile(
      join(root, ".changeset/pre.json"),
      JSON.stringify({ mode: "pre", tag: "alpha" }),
    );
    expect(await distTags.readPrereleaseTag(root)).toBe("alpha");

    await writeFile(
      join(root, ".changeset/pre.json"),
      JSON.stringify({ mode: "exit", tag: "alpha" }),
    );
    expect(await distTags.readPrereleaseTag(root)).toBeUndefined();
  });
});
