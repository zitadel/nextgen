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

  it("rejects a workflow that leaves pruned changesets dirty for GoReleaser", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        [
          "      - name: Restore changesets after publish decision",
          "        run: git restore -- .changeset",
          "",
        ].join("\n"),
        "",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must restore pruned changesets before inspecting or running GoReleaser");
  });

  it("rejects a workflow that cannot recover an existing Go release tag", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        [
          "      - name: Check out existing Go release tag",
          "        if: ${{ steps.alpha.outputs.run_goreleaser == 'true' && steps.alpha.outputs.tag_exists == 'true' }}",
          "        run: git checkout --detach \"$TAG\"",
        ].join("\n"),
        "",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must check out an existing Go tag before recovering GoReleaser");
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
        "        if: ${{ steps.alpha.outputs.update_release == 'true' }}",
        "        if: ${{ steps.changesets.outputs.published == 'true' }}",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("post-npm alpha train steps must not be gated only on Changesets publishing");
  });

  it("rejects a workflow that does not refresh the CLI alpha dist-tags", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        [
          "      - name: Refresh CLI npm dist-tags",
          "        if: ${{ steps.alpha.outputs.version != '' }}",
          "        run: |",
          '          npm dist-tag add "@zitadel/cli@$version" alpha || echo "::warning::Unable to refresh @zitadel/cli@$version npm alpha dist-tag"',
          '          npm dist-tag add "@zitadel/cli@$version" latest || echo "::warning::Unable to promote @zitadel/cli@$version to npm latest dist-tag"',
          "",
        ].join("\n"),
        "",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must refresh CLI npm dist-tags after verifying the npm train");
  });

  it("rejects a workflow that refreshes CLI dist-tags before alpha train preparation", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow()
        .replace(
          [
            "      - name: Refresh CLI npm dist-tags",
            "        if: ${{ steps.alpha.outputs.version != '' }}",
            "        run: |",
            '          npm dist-tag add "@zitadel/cli@$version" alpha || echo "::warning::Unable to refresh @zitadel/cli@$version npm alpha dist-tag"',
            '          npm dist-tag add "@zitadel/cli@$version" latest || echo "::warning::Unable to promote @zitadel/cli@$version to npm latest dist-tag"',
            "",
          ].join("\n"),
          "",
        )
        .replace(
          "      - name: Inspect alpha release train candidate",
          [
            "      - name: Refresh CLI npm dist-tags",
            "        if: ${{ steps.alpha.outputs.version != '' }}",
            "        run: |",
            '          npm dist-tag add "@zitadel/cli@$version" alpha || echo "::warning::Unable to refresh @zitadel/cli@$version npm alpha dist-tag"',
            '          npm dist-tag add "@zitadel/cli@$version" latest || echo "::warning::Unable to promote @zitadel/cli@$version to npm latest dist-tag"',
            "",
            "      - name: Inspect alpha release train candidate",
          ].join("\n"),
        ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must refresh CLI npm dist-tags after alpha train preparation");
  });

  it("rejects a workflow that refreshes the CLI alpha tag outside the release job", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow()
        .replace(
          '          npm dist-tag add "@zitadel/cli@$version" alpha',
          '          echo "alpha tag moved elsewhere"',
        )
        .replace(
          "  ci-success:\n    steps:",
          [
            "  ci-success:",
            "    steps:",
            "      - run: |",
            '          npm dist-tag add "@zitadel/cli@$version" alpha',
          ].join("\n"),
        ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must keep the CLI alpha dist-tag on the published train");
  });

  it("rejects a workflow that fails the train when npm latest promotion fails", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        '          npm dist-tag add "@zitadel/cli@$version" latest || echo "::warning::Unable to promote @zitadel/cli@$version to npm latest dist-tag"',
        '          npm dist-tag add "@zitadel/cli@$version" latest',
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must not fail the alpha train when npm latest dist-tag promotion fails");
  });

  it("rejects a workflow that moves the CLI latest tag outside the release job", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow()
        .replace(
          '          npm dist-tag add "@zitadel/cli@$version" latest',
          '          echo "latest tag moved elsewhere"',
        )
        .replace(
          "  ci-success:\n    steps:",
          [
            "  ci-success:",
            "    steps:",
            "      - run: |",
            '          npm dist-tag add "@zitadel/cli@$version" latest',
          ].join("\n"),
        ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("must move only the CLI npm latest dist-tag during alpha");
  });

  it("rejects a workflow that moves any non-CLI package to npm latest", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      ciWorkflow: validCiWorkflow().replace(
        '          npm dist-tag add "@zitadel/cli@$version" latest',
        [
          '          npm dist-tag add "@zitadel/cli@$version" latest',
          '          npm dist-tag add "@zitadel/sdk-next@$version" latest',
        ].join("\n"),
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("only @zitadel/cli may move the npm latest dist-tag");
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

  it("rejects a missing manual alpha recovery workflow", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      recoveryWorkflow: null,
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("alpha recovery workflow must exist");
  });

  it("rejects an alpha recovery workflow that can run Changesets", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      recoveryWorkflow: `${validRecoveryWorkflow()}\n      - uses: changesets/action@v1\n`,
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("alpha recovery must not create a Version Packages PR or publish npm");
  });

  it("rejects an alpha recovery workflow that defaults to a moving ref", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      recoveryWorkflow: validRecoveryWorkflow().replace(
        "      ref:",
        "      ref:\n        default: main",
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("alpha recovery must not default to a moving ref");
  });

  it("rejects an alpha recovery workflow that does not verify npm packages", async () => {
    const { cwd, statusPath } = await fixtureRepo({
      recoveryWorkflow: validRecoveryWorkflow().replace(
        'execFileSync("npm", ["view", `${expectedName}@${version}`, "version", "--json"]',
        'execFileSync("npm", ["ping"]',
      ),
    });

    await expect(
      checkAlphaReleasePlanModule.checkAlphaReleasePlan({ cwd, statusPath }),
    ).rejects.toThrow("alpha recovery must verify the npm package train already exists");
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
    "      - name: Restore changesets after publish decision",
    "        run: git restore -- .changeset",
    "",
    "      - name: Inspect alpha release train candidate",
    "        id: alpha-status",
    "        run: |",
    "          node scripts/release-alpha-train.mjs status --published \"$PUBLISHED\" --remote false",
    "      - name: Prepare alpha release train",
    "        if: ${{ steps.alpha-status.outputs.should_complete == 'true' }}",
    "        id: alpha",
    "        run: |",
    "          alpha_env=\"$RUNNER_TEMP/alpha-release.env\"",
    "          node scripts/release-alpha-train.mjs prepare --published \"$PUBLISHED\" --out-dir \"$RUNNER_TEMP/alpha-release\" | tee \"$alpha_env\"",
    "          cat \"$alpha_env\" >> \"$GITHUB_OUTPUT\"",
    "      - name: Refresh CLI npm dist-tags",
    "        if: ${{ steps.alpha.outputs.version != '' }}",
    "        run: |",
    '          npm dist-tag add "@zitadel/cli@$version" alpha || echo "::warning::Unable to refresh @zitadel/cli@$version npm alpha dist-tag"',
    '          npm dist-tag add "@zitadel/cli@$version" latest || echo "::warning::Unable to promote @zitadel/cli@$version to npm latest dist-tag"',
    "",
    "      - name: Create and push Go release tag",
    "        if: ${{ steps.alpha.outputs.create_tag == 'true' }}",
    "        run: git tag \"$TAG\"",
    "      - name: Check out existing Go release tag",
    "        if: ${{ steps.alpha.outputs.run_goreleaser == 'true' && steps.alpha.outputs.tag_exists == 'true' }}",
    "        run: git checkout --detach \"$TAG\"",
    "      - name: Run GoReleaser",
    "        if: ${{ steps.alpha.outputs.run_goreleaser == 'true' }}",
    "        run: goreleaser release --clean",
    "      - name: Update GitHub Release notes",
    "        if: ${{ steps.alpha.outputs.update_release == 'true' }}",
    "        run: gh release edit \"$TAG\" --prerelease --latest=false",
    "",
  ].join("\n");
}

function validRecoveryWorkflow(): string {
  return [
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      alpha_version:",
    "      ref:",
    "jobs:",
    "  recover-alpha-train:",
    "    steps:",
    "      - run: |",
    "          node scripts/release-alpha-train.mjs status --published true --remote false",
    '          values.should_complete !== "true"',
    "          PUBLIC_PACKAGE_MANIFESTS",
    "          PUBLIC_PACKAGE_NAMES",
    "          validateAlphaVersion(version)",
    "          manifest.version !== version",
    '          execFileSync("npm", ["view", `${expectedName}@${version}`, "version", "--json"]',
    "      - uses: docker/login-action@v4",
    "      - run: |",
    "          node scripts/release-alpha-train.mjs status --published true",
    '          node scripts/release-alpha-train.mjs prepare --published true --out-dir "$RUNNER_TEMP/alpha-release"',
    "      - if: ${{ steps.alpha.outputs.create_tag == 'true' }}",
    "        run: git tag \"$TAG\"",
    "      - if: ${{ steps.alpha.outputs.run_goreleaser == 'true' && steps.alpha.outputs.tag_exists == 'true' }}",
    "        run: git checkout --detach \"$TAG\"",
    "      - uses: goreleaser/goreleaser-action@v7",
    "      - run: gh release edit \"$TAG\" --latest=false",
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
    recoveryWorkflow?: string | null;
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
  if (options.recoveryWorkflow !== null) {
    await writeFile(
      join(cwd, ".github/workflows/recover-alpha-train.yml"),
      options.recoveryWorkflow ?? validRecoveryWorkflow(),
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
