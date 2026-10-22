import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Capture = (command: string, args: string[]) => Promise<{ stdout: string }>;

type LocalPackage = { name: string; version: string; license: string };

type PublishBlockers = { unpublished: LocalPackage[] };

type ReleaseNpmPreflightModule = {
  findPublishBlockers: (
    packages: LocalPackage[],
    options: { capture: Capture },
  ) => Promise<PublishBlockers>;
  publishBlockersMessage: (blockers: PublishBlockers) => string;
  readLocalPackages: (root: string, dirs: string[]) => Promise<LocalPackage[]>;
  readPublishedVersions: (name: string, options: { capture: Capture }) => Promise<string[]>;
};

let preflight: ReleaseNpmPreflightModule;
const tempDirs: string[] = [];

beforeAll(async () => {
  preflight = (await import(
    new URL("../../../../../scripts/release-npm-preflight.mjs", import.meta.url).href
  )) as ReleaseNpmPreflightModule;
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

function localPackage(name: string, version = "0.1.0", license = "MIT"): LocalPackage {
  return { name, version, license };
}

describe("release npm preflight", () => {
  it("finds the packages that were never published", async () => {
    // Trusted publishing cannot create a package, so its first publish fails.
    const capture = npmView({
      "@zitadel/sdk-react": ["0.0.0", "1.0.0-alpha.28"],
      "@zitadel/sdk-qwik": "0.0.0-bootstrap.0",
    });

    const blockers = await preflight.findPublishBlockers(
      [
        localPackage("@zitadel/sdk-react"),
        localPackage("@zitadel/sdk-qwik"),
        localPackage("@zitadel/sdk-svelte"),
      ],
      { capture },
    );

    expect(blockers.unpublished.map((pkg) => pkg.name)).toEqual(["@zitadel/sdk-svelte"]);
  });

  it("rethrows registry failures other than a missing package", async () => {
    const capture: Capture = async () => {
      throw Object.assign(new Error("npm view failed with exit 1"), {
        stdout: JSON.stringify({ error: { code: "ETIMEDOUT" } }),
      });
    };

    await expect(
      preflight.readPublishedVersions("@zitadel/sdk-solid", { capture }),
    ).rejects.toThrow("npm view failed");
  });

  it("tells the maintainer to bootstrap and add a trusted publisher for a never-published package", () => {
    const message = preflight.publishBlockersMessage({
      unpublished: [localPackage("@zitadel/server", "0.1.0", "AGPL-3.0-only")],
    });

    expect(message).toContain("@zitadel/server has never been published to npm");
    expect(message).toContain('"@zitadel/server" "AGPL-3.0-only" "@zitadel/server"');
    expect(message).toContain(
      "add a trusted publisher for @zitadel/server on npmjs.com (package Settings → Trusted Publishing: GitHub Actions, repository zitadel/nextgen, workflow release-publish.yml)",
    );
    expect(message).toContain(".changeset/README.md");
    expect(message).toContain(
      "npm trust github @zitadel/server --repo zitadel/nextgen --file release-publish.yml --allow-publish --yes",
    );
  });

  it("gives each never-published package its own bootstrap and trust command", () => {
    const message = preflight.publishBlockersMessage({
      unpublished: [localPackage("@zitadel/sdk-sveltekit"), localPackage("@zitadel/sdk-qwik-city")],
    });

    expect(message.match(/npm publish --access public --tag bootstrap/g)).toHaveLength(2);
    expect(message.match(/^npm trust github .*$/gm)).toEqual([
      "npm trust github @zitadel/sdk-sveltekit --repo zitadel/nextgen --file release-publish.yml --allow-publish --yes",
      "npm trust github @zitadel/sdk-qwik-city --repo zitadel/nextgen --file release-publish.yml --allow-publish --yes",
    ]);
    // Printed by the publish job and by the version PR's check alike.
    expect(message.trimEnd().endsWith("Then rerun this job.")).toBe(true);
  });

  it("reads each package's name, version, and license", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-npm-preflight-"));
    tempDirs.push(root);
    await mkdir(join(root, "packages/sdk-solid"), { recursive: true });
    await writeFile(
      join(root, "packages/sdk-solid/package.json"),
      JSON.stringify({ name: "@zitadel/sdk-solid", version: "0.1.0", license: "MIT" }),
    );
    await mkdir(join(root, "packages/no-license"), { recursive: true });
    await writeFile(
      join(root, "packages/no-license/package.json"),
      JSON.stringify({ name: "@zitadel/no-license", version: "0.1.0" }),
    );

    expect(await preflight.readLocalPackages(root, ["packages/sdk-solid"])).toEqual([
      localPackage("@zitadel/sdk-solid"),
    ]);
    await expect(preflight.readLocalPackages(root, ["packages/no-license"])).rejects.toThrow(
      "has no license",
    );
  });

  it("skips a private package", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-npm-preflight-"));
    tempDirs.push(root);
    await mkdir(join(root, "packages/internal"), { recursive: true });
    await writeFile(
      join(root, "packages/internal/package.json"),
      JSON.stringify({ name: "@zitadel/internal", version: "0.0.0", private: true }),
    );
    await mkdir(join(root, "packages/sdk-solid"), { recursive: true });
    await writeFile(
      join(root, "packages/sdk-solid/package.json"),
      JSON.stringify({ name: "@zitadel/sdk-solid", version: "0.1.0", license: "MIT" }),
    );

    expect(
      await preflight.readLocalPackages(root, ["packages/internal", "packages/sdk-solid"]),
    ).toEqual([localPackage("@zitadel/sdk-solid")]);
  });
});
