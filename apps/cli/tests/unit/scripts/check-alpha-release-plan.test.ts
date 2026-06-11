import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

type CheckAlphaReleasePlanModule = {
  checkAlphaReleasePlan: (options: { cwd: string; statusPath: string }) => Promise<{
    releaseVersion?: string;
  }>;
};

let checkAlphaReleasePlanModule: CheckAlphaReleasePlanModule;
const tempDirs: string[] = [];

const publicPackageNames = [
  "@zitadel/cli",
  "@zitadel/api",
  "@zitadel/components",
  "@zitadel/sdk-core",
  "@zitadel/sdk-next",
  "@zitadel/sdk-nuxt",
  "@zitadel/sdk-react",
  "@zitadel/sdk-vue",
  "@zitadel/sdk-angular",
];

beforeAll(async () => {
  checkAlphaReleasePlanModule = (await import(
    new URL("../../../../../scripts/check-alpha-release-plan.mjs", import.meta.url).href
  )) as CheckAlphaReleasePlanModule;
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("check-alpha-release-plan script", () => {
  it("accepts a lockstep alpha release plan", async () => {
    const { cwd, statusPath } = await fixtureRepo();

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).resolves.toEqual({ releaseVersion: "0.1.0-alpha.5" });
  });

  it("allows no public package release to be planned", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      releases: [],
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).resolves.toEqual({ releaseVersion: undefined });
  });

  it("rejects mismatched alpha train versions", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      versionOverrides: { "@zitadel/sdk-next": "0.1.0-alpha.4" },
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("alpha train versions must be lockstep");
  });

  it("rejects a missing Docker latest prerelease guard", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      goreleaser: [
        "dockers_v2:",
        "  - tags:",
        "      - '{{ .Version }}'",
        "      - '{{ if not .IsSnapshot }}latest{{ end }}'",
        "release:",
        "  draft: true",
        "  prerelease: auto",
        "  make_latest: '{{ if .Prerelease }}false{{ else }}true{{ end }}'",
        "",
      ].join("\n"),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("Docker latest tag must be gated");
  });

  it("rejects a workflow that lets Changesets create GitHub Releases", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      releaseWorkflow: [
        "jobs:",
        "  release:",
        "    steps:",
        "      - uses: changesets/action@v1",
        "        with:",
        "          createGithubReleases: true",
        "      - run: node scripts/release-alpha-train.mjs prepare",
        "      - run: gh release edit \"$TAG\" --prerelease --latest=false",
        "",
      ].join("\n"),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("Changesets must not create package-shaped GitHub Releases");
  });
});

async function fixtureRepo(
  options: {
    releases?: Array<{ name: string; type: string; newVersion: string }>;
    versionOverrides?: Record<string, string>;
    goreleaser?: string;
    releaseWorkflow?: string;
  } = {},
): Promise<{ cwd: string; statusPath: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-alpha-check-"));
  tempDirs.push(cwd);

  await writeJson(join(cwd, ".changeset/config.json"), {
    fixed: [publicPackageNames],
  });
  await writeFile(
    join(cwd, ".goreleaser.yaml"),
    options.goreleaser ??
      [
        "dockers_v2:",
        "  - tags:",
        "      - '{{ .Version }}'",
        "      - '{{ if and (not .IsSnapshot) (eq .Prerelease \"\") }}latest{{ end }}'",
        "release:",
        "  draft: true",
        "  prerelease: auto",
        "  make_latest: '{{ if .Prerelease }}false{{ else }}true{{ end }}'",
        "",
      ].join("\n"),
  );
  await mkdir(join(cwd, ".github/workflows"), { recursive: true });
  await writeFile(
    join(cwd, ".github/workflows/release-npm.yml"),
    options.releaseWorkflow ??
      [
        "jobs:",
        "  release:",
        "    steps:",
        "      - uses: changesets/action@v1",
        "        with:",
        "          createGithubReleases: false",
        "      - run: node scripts/release-alpha-train.mjs prepare",
        "      - run: gh release edit \"$TAG\" --prerelease --latest=false",
        "",
      ].join("\n"),
  );

  const statusPath = join(cwd, "changeset-status.json");
  await writeJson(statusPath, {
    releases:
      options.releases ??
      publicPackageNames.map((name) => ({
        name,
        type: "patch",
        newVersion: options.versionOverrides?.[name] ?? "0.1.0-alpha.5",
      })),
  });

  return { cwd, statusPath };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
