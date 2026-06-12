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

const releaseJobCondition =
  "    if: always() && github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.detect-alpha-release.result == 'success' && needs.ci-success.result == 'success' && needs.detect-alpha-release.outputs.should_release == 'true'";
const inheritedSkipReleaseJobCondition =
  "    if: github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.detect-alpha-release.outputs.should_release == 'true'";

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
      ciWorkflow: validCiWorkflow().replace(
        "createGithubReleases: false",
        "createGithubReleases: true",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("Changesets must not create package-shaped GitHub Releases");
  });

  it("rejects a workflow that lets empty changesets suppress npm publishing", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        [
          "      - name: Prune empty changesets before publish decision",
          "        run: node scripts/release-alpha-train.mjs prune-empty-changesets",
        ].join("\n"),
        "",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must prune empty changesets before Changesets decides whether to publish");
  });

  it("rejects alpha release notes generated inside the checkout", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
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
      ciWorkflow: validCiWorkflow().replace(
        "      - if: ${{ steps.alpha.outputs.update_release == 'true' }}",
        "      - if: ${{ steps.changesets.outputs.published == 'true' }}",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("post-npm alpha train steps must not be gated only on Changesets publishing");
  });

  it("rejects a release job condition that can inherit intentional main-branch skips", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        releaseJobCondition,
        inheritedSkipReleaseJobCondition,
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must explicitly require release relevance and a successful CI gate");
  });

  it("rejects a release job condition that only appears on a different job", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow()
        .replace(releaseJobCondition, inheritedSkipReleaseJobCondition)
        .replace(
          "  ci-success:\n    steps:",
          ["  ci-success:", releaseJobCondition, "    steps:"].join("\n"),
        ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must explicitly require release relevance and a successful CI gate");
  });

  it("rejects a legacy standalone release workflow", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      legacyReleaseWorkflow: "name: release-npm\n",
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("release publishing must live in ci.yml");
  });

  it("rejects CI path filters that can skip release relevance detection", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        "  push:\n    branches: [main]",
        '  push:\n    branches: [main]\n    paths:\n      - ".changeset/**"',
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must not path-filter main pushes");
  });

  it("rejects a workflow missing release job publish permissions", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace("      packages: write\n", ""),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must scope publish permissions");
  });

  it("rejects a workflow that can publish before main CI succeeds", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        "    needs: [detect-alpha-release, ci-success]",
        "    needs: [detect-alpha-release]",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must wait for release relevance detection and the aggregate CI gate");
  });
});

function validCiWorkflow(): string {
  return [
    "on:",
    "  pull_request:",
    "  push:",
    "    branches: [main]",
    "permissions:",
    "  contents: read",
    "concurrency:",
    "  group: ci-${{ github.workflow }}-${{ github.ref }}",
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    "jobs:",
    "  detect-alpha-release:",
    "    outputs:",
    "      should_release: ${{ steps.detect.outputs.should_release }}",
    "    steps:",
    "      - id: detect",
    "        run: |",
    '          import { PUBLIC_PACKAGE_MANIFESTS } from "./scripts/release-alpha-train.mjs";',
    '          path.startsWith(".changeset/") || publicPackageReleasePaths.has(path)',
    "  ci-success:",
    "    steps:",
    "      - run: |",
    '          const allowedSkipped = new Set(["changeset-check"]);',
    "  release-alpha-train:",
    releaseJobCondition,
    "    needs: [detect-alpha-release, ci-success]",
    "    permissions:",
    "      contents: write",
    "      pull-requests: write",
    "      packages: write",
    "      id-token: write",
    "    steps:",
    "      - name: Prune empty changesets before publish decision",
    "        run: node scripts/release-alpha-train.mjs prune-empty-changesets",
    "",
    "      - name: Create release PR or publish to npm",
    "        uses: changesets/action@v1",
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

async function fixtureRepo(
  options: {
    releases?: Array<{ name: string; type: string; newVersion: string }>;
    versionOverrides?: Record<string, string>;
    goreleaser?: string;
    ciWorkflow?: string;
    legacyReleaseWorkflow?: string;
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
    join(cwd, ".github/workflows/ci.yml"),
    options.ciWorkflow ?? validCiWorkflow(),
  );
  if (options.legacyReleaseWorkflow !== undefined) {
    await writeFile(
      join(cwd, ".github/workflows/release-npm.yml"),
      options.legacyReleaseWorkflow,
    );
  }

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
