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

const publicPackageManifestPaths = [
  "apps/cli/package.json",
  "packages/api/package.json",
  "packages/components/package.json",
  "packages/sdk-core/package.json",
  "packages/sdk-next/package.json",
  "packages/sdk-nuxt/package.json",
  "packages/sdk-react/package.json",
  "packages/sdk-vue/package.json",
  "packages/sdk-angular/package.json",
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
      releaseWorkflow: validReleaseWorkflow().replace(
        "createGithubReleases: false",
        "createGithubReleases: true",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("Changesets must not create package-shaped GitHub Releases");
  });

  it("rejects alpha release notes generated inside the checkout", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      releaseWorkflow: validReleaseWorkflow().replace(
        '--out-dir "$RUNNER_TEMP/alpha-release" | tee "$alpha_env"',
        "--out-dir dist/alpha-release | tee dist/alpha-release.env",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must write alpha release notes outside the checkout");
  });

  it("rejects workflow steps gated only on the current Changesets publish result", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      releaseWorkflow: validReleaseWorkflow().replace(
        "      - if: ${{ steps.alpha.outputs.update_release == 'true' }}",
        "      - if: ${{ steps.changesets.outputs.published == 'true' }}",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("post-npm alpha train steps must not be gated only on Changesets publishing");
  });

  it("rejects a workflow without release-relevant path filters", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      releaseWorkflow: validReleaseWorkflow().replace(
        / {4}paths:\n(?: {6}- "[^"]+"\n)+/,
        "",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must limit main pushes to release-relevant files");
  });

  it("rejects a workflow missing actions read permission", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      releaseWorkflow: validReleaseWorkflow().replace("  actions: read\n", ""),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must grant actions: read");
  });

  it("rejects a workflow that can publish before main CI succeeds", async () => {
    const waitStep = mainCiWaitStep();
    const { cwd, statusPath } = await fixtureRepo({
      releaseWorkflow: validReleaseWorkflow()
        .replace(waitStep, "")
        .replace("      - id: alpha-status", `${waitStep}      - id: alpha-status`),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must wait for main CI before Changesets can publish");
  });
});

function validReleaseWorkflow(): string {
  const releasePaths = [
    ".changeset/**",
    ...publicPackageManifestPaths.flatMap((path) => [
      path,
      path.replace(/package\.json$/, "CHANGELOG.md"),
    ]),
  ];

  return [
    "on:",
    "  push:",
    "    branches: [main]",
    "    paths:",
    ...releasePaths.map((path) => `      - "${path}"`),
    "permissions:",
    "  contents: write",
    "  pull-requests: write",
    "  packages: write",
    "  id-token: write",
    "  actions: read",
    "jobs:",
    "  release:",
    "    steps:",
    mainCiWaitStep().trimEnd(),
    "      - uses: changesets/action@v1",
    "        with:",
    "          createGithubReleases: false",
    "      - id: alpha-status",
    "        run: |",
    "          node scripts/release-alpha-train.mjs status --published \"$PUBLISHED\" --remote false",
    "      - if: ${{ steps.alpha-status.outputs.should_complete == 'true' }}",
    "        id: alpha",
    "        run: |",
    "          alpha_env=\"$RUNNER_TEMP/alpha-release.env\"",
    "          node scripts/release-alpha-train.mjs prepare --published \"$PUBLISHED\" --out-dir \"$RUNNER_TEMP/alpha-release\" | tee \"$alpha_env\"",
    "          cat \"$alpha_env\" >> \"$GITHUB_OUTPUT\"",
    "      - if: ${{ steps.alpha.outputs.create_tag == 'true' }}",
    "        run: git tag \"$TAG\"",
    "      - if: ${{ steps.alpha.outputs.run_goreleaser == 'true' }}",
    "        run: goreleaser release --clean",
    "      - if: ${{ steps.alpha.outputs.update_release == 'true' }}",
    "        run: gh release edit \"$TAG\" --prerelease --latest=false",
    "",
  ].join("\n");
}

function mainCiWaitStep(): string {
  return [
    "      - name: Wait for main CI",
    "        run: |",
    '          run_fields="$(gh run list --workflow ci.yml --branch main --commit "$GITHUB_SHA" --event push --limit 1 --json status,conclusion,url --jq \'.[] | [.status, (.conclusion // ""), .url] | @tsv\')"',
    "          if [ \"$conclusion\" = \"success\" ]; then exit 0; fi",
    "          echo \"::error::timed out waiting for main CI\"",
    "",
  ].join("\n");
}

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
    options.releaseWorkflow ?? validReleaseWorkflow(),
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
