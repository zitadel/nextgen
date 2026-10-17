import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Capture = (command: string, args: string[]) => Promise<{ stdout: string }>;

type LocalPackage = { name: string; version: string; license: string };

type PublishBlockers = { unpublished: LocalPackage[]; prereleaseOnly: LocalPackage[] };

type ReleaseDistTagsModule = {
  findPublishBlockers: (
    packages: LocalPackage[],
    tag: string | undefined,
    options: { capture: Capture },
  ) => Promise<PublishBlockers>;
  isPrereleaseOnly: (versions: string[], tag: string) => boolean;
  prereleaseIdentifier: (version: string) => string | undefined;
  publishBlockersMessage: (blockers: PublishBlockers, tag: string | undefined) => string;
  readLocalPackages: (root: string, dirs: string[]) => Promise<LocalPackage[]>;
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

function localPackage(name: string, version = "1.0.0-alpha.26", license = "MIT"): LocalPackage {
  return { name, version, license };
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
    // Never published is its own blocker, not this one.
    expect(distTags.isPrereleaseOnly([], "alpha")).toBe(false);
  });

  it("finds the packages changeset publish would put on latest", async () => {
    const capture = npmView({
      "@zitadel/sdk-react": ["0.0.0", "1.0.0-alpha.25"],
      "@zitadel/sdk-solid": ["0.1.0-alpha.11", "1.0.0-alpha.25"],
      "@zitadel/server": ["0.0.0-oidc-bootstrap.0", "1.0.0-alpha.25"],
      "@zitadel/sdk-qwik": "1.0.0-alpha.25",
    });

    const blockers = await distTags.findPublishBlockers(
      [
        localPackage("@zitadel/sdk-react"),
        localPackage("@zitadel/sdk-solid"),
        localPackage("@zitadel/server"),
        localPackage("@zitadel/sdk-qwik"),
      ],
      "alpha",
      { capture },
    );

    expect(blockers.prereleaseOnly.map((pkg) => pkg.name)).toEqual([
      "@zitadel/sdk-solid",
      "@zitadel/sdk-qwik",
    ]);
    expect(blockers.unpublished).toEqual([]);
  });

  it.each([
    ["in pre mode", "alpha"],
    ["outside pre mode", undefined],
  ])("finds the packages that were never published %s", async (_mode, tag) => {
    // Trusted publishing cannot create a package, so its first publish fails.
    const capture = npmView({ "@zitadel/sdk-react": ["0.0.0", "1.0.0-alpha.25"] });

    const blockers = await distTags.findPublishBlockers(
      [localPackage("@zitadel/sdk-react"), localPackage("@zitadel/sdk-svelte")],
      tag,
      { capture },
    );

    expect(blockers.unpublished.map((pkg) => pkg.name)).toEqual(["@zitadel/sdk-svelte"]);
  });

  it("checks prerelease-only packages only in pre mode", async () => {
    const capture = npmView({ "@zitadel/sdk-solid": ["0.1.0-alpha.11", "1.0.0-alpha.25"] });

    const blockers = await distTags.findPublishBlockers(
      [localPackage("@zitadel/sdk-solid", "1.0.0")],
      undefined,
      { capture },
    );

    expect(blockers).toEqual({ unpublished: [], prereleaseOnly: [] });
  });

  it("skips a package whose local version is already published", async () => {
    // changeset publish skips it too, so a recovery run of a published
    // release must not stop here.
    const capture = npmView({ "@zitadel/sdk-solid": ["0.1.0-alpha.11", "1.0.0-alpha.25"] });

    const blockers = await distTags.findPublishBlockers(
      [localPackage("@zitadel/sdk-solid", "1.0.0-alpha.25")],
      "alpha",
      { capture },
    );

    expect(blockers).toEqual({ unpublished: [], prereleaseOnly: [] });
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

  it("names the packages and gives a bootstrap command with each one's license", () => {
    const message = distTags.publishBlockersMessage(
      {
        unpublished: [],
        prereleaseOnly: [
          localPackage("@zitadel/sdk-solid"),
          localPackage("@zitadel/server", "1.0.0-alpha.26", "AGPL-3.0-only"),
        ],
      },
      "alpha",
    );

    expect(message).toContain("@zitadel/sdk-solid, @zitadel/server only have `alpha`");
    expect(message.match(/npm publish --access public --tag bootstrap/g)).toHaveLength(2);
    expect(message).toContain('"@zitadel/sdk-solid" "MIT" "@zitadel/sdk-solid@alpha"');
    expect(message).toContain('"@zitadel/server" "AGPL-3.0-only" "@zitadel/server@alpha"');
    expect(message).not.toContain("Trusted Publishing");
  });

  it("tells the maintainer to bootstrap and add a trusted publisher for a never-published package", () => {
    const message = distTags.publishBlockersMessage(
      { unpublished: [localPackage("@zitadel/sdk-svelte")], prereleaseOnly: [] },
      "alpha",
    );

    expect(message).toContain("@zitadel/sdk-svelte has never been published to npm");
    expect(message).toContain('"@zitadel/sdk-svelte" "MIT" "@zitadel/sdk-svelte@alpha"');
    expect(message).toContain(
      "add a trusted publisher for @zitadel/sdk-svelte on npmjs.com (package Settings → Trusted Publishing: GitHub Actions, repository zitadel/nextgen, workflow release-publish.yml)",
    );
    expect(message).toContain(".changeset/README.md");
  });

  it("reads each package's name, version, and license", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-dist-tags-"));
    tempDirs.push(root);
    await mkdir(join(root, "packages/sdk-solid"), { recursive: true });
    await writeFile(
      join(root, "packages/sdk-solid/package.json"),
      JSON.stringify({ name: "@zitadel/sdk-solid", version: "1.0.0-alpha.26", license: "MIT" }),
    );
    await mkdir(join(root, "packages/no-license"), { recursive: true });
    await writeFile(
      join(root, "packages/no-license/package.json"),
      JSON.stringify({ name: "@zitadel/no-license", version: "1.0.0-alpha.26" }),
    );

    expect(await distTags.readLocalPackages(root, ["packages/sdk-solid"])).toEqual([
      localPackage("@zitadel/sdk-solid"),
    ]);
    await expect(distTags.readLocalPackages(root, ["packages/no-license"])).rejects.toThrow(
      "has no license",
    );
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
