import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type CheckChangesetsStatusModule = {
  checkChangesetsStatus: (options: {
    base?: string;
    pending?: boolean;
    versionPr?: boolean;
    entries: Array<{ status: string; file: string }>;
    config: { fixed: string[][] };
    changesetSources?: Record<string, string>;
    changesetStatus?: {
      changesets?: Array<{
        id: string;
        releases: Array<{ name: string; type: string }>;
      }>;
      releases?: Array<{
        name: string;
        type: string;
        oldVersion?: string;
        newVersion?: string;
        changesets?: string[];
      }>;
    };
    runChangesetStatus?: (options: {
      repoRoot: string;
      base: string;
      pending: boolean;
    }) => Promise<CheckChangesetStatus>;
  }) => Promise<{
    ok: boolean;
    errors: Array<{ code: string; message: string }>;
    analysis: {
      versionOnly: boolean;
      changedPackages: Array<{ name: string; files: string[] }>;
    };
    nextAction: string;
  }>;
  publicPackages: Array<{ name: string; root: string }>;
};

type ReleaseAutomationModule = {
  detectReleaseAutomation: (options: {
    mode: "publish";
    base?: string;
    entries?: Array<{ status: string; file: string }>;
    message?: string;
    pendingChangesets?: string[];
    releasePendingChangesets?: string[];
    prereleaseChangesetIds?: string[];
  }) => Promise<{
    ok: boolean;
    shouldRun: boolean;
    reason: string;
    errors: string[];
  }>;
  isVersionPackageCommit: (message: string) => boolean;
};

type ReleaseModule = {
  assertNoUnrecordedPendingChangesets: (repoRoot: string) => Promise<void>;
  releasePublishEnv: (env?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  shouldFailManualPublishSkip: (
    options: { dryRun?: boolean; recoverVersion?: string },
    env?: NodeJS.ProcessEnv,
  ) => boolean;
};

type CheckChangesetStatus = {
  changesets?: Array<{
    id: string;
    releases: Array<{ name: string; type: string }>;
  }>;
  releases?: Array<{
    name: string;
    type: string;
    oldVersion?: string;
    newVersion?: string;
    changesets?: string[];
  }>;
};

const releaseManifest = (await import(
  new URL("../../../../../scripts/release-manifest.mjs", import.meta.url).href
)) as { PUBLIC_PACKAGE_NAMES: string[] };

async function loadModule(): Promise<CheckChangesetsStatusModule> {
  return (await import(
    new URL("../../../../../scripts/check-changesets-status.mjs", import.meta.url).href
  )) as CheckChangesetsStatusModule;
}

async function loadReleaseAutomationModule(): Promise<ReleaseAutomationModule> {
  return (await import(
    new URL("../../../../../scripts/release-automation.mjs", import.meta.url).href
  )) as ReleaseAutomationModule;
}

async function loadReleaseModule(): Promise<ReleaseModule> {
  return (await import(
    new URL("../../../../../scripts/release.mjs", import.meta.url).href
  )) as ReleaseModule;
}

describe("check-changesets-status", () => {
  it("passes when no publishable package paths changed", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [{ status: "M", file: "docs/adrs/024-ci.md" }],
      config: validConfig(),
    });

    expect(report.ok).toBe(true);
    expect(report.analysis.changedPackages).toEqual([]);
    expect(report.nextAction).toContain("No changeset required");
  });

  it("fails when publishable package paths changed without a changeset", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [{ status: "M", file: "apps/cli/src/commands/start.ts" }],
      config: validConfig(),
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-changeset",
        }),
      ]),
    );
  });

  it("passes when a valid changeset is present", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [
        { status: "M", file: "apps/cli/src/commands/start.ts" },
        { status: "A", file: ".changeset/cli-start.md" },
      ],
      config: validConfig(),
      changesetSources: {
        ".changeset/cli-start.md": `---
"@zitadel/cli": minor
---

Improve local start behavior.
`,
      },
      changesetStatus: {
        changesets: [
          {
            id: "cli-start",
            releases: [{ name: "@zitadel/cli", type: "minor" }],
          },
        ],
        releases: [
          {
            name: "@zitadel/cli",
            type: "minor",
            oldVersion: "0.1.0-alpha.5",
            newVersion: "0.1.0-alpha.6",
            changesets: ["cli-start"],
          },
        ],
      },
    });

    expect(report.ok).toBe(true);
    expect(report.nextAction).toContain("Changesets are present");
  });

  it("passes when an empty changeset covers non-shipping publishable path changes", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [
        { status: "M", file: "apps/cli/src/lib/diagnostics.ts" },
        { status: "A", file: ".changeset/release-tests.md" },
      ],
      config: validConfig(),
      changesetSources: {
        ".changeset/release-tests.md": `---
---

Internal-only change with no published package behavior.
`,
      },
    });

    expect(report.ok).toBe(true);
    expect(report.nextAction).toContain("Empty changeset");
  });

  it("treats test-only changes under a publishable root as needing no changeset", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [
        { status: "M", file: "apps/cli/tests/unit/scripts/check-changesets-status.test.ts" },
      ],
      config: validConfig(),
    });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.nextAction).toContain("No changeset required");
  });

  it("passes pending mode when public changesets are valid", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      pending: true,
      entries: [{ status: "A", file: ".changeset/cli-start.md" }],
      config: validConfig(),
      changesetSources: {
        ".changeset/cli-start.md": `---
"@zitadel/cli": minor
---

Improve local start behavior.
`,
      },
      changesetStatus: {
        changesets: [
          {
            id: "cli-start",
            releases: [{ name: "@zitadel/cli", type: "minor" }],
          },
        ],
        releases: [
          {
            name: "@zitadel/cli",
            type: "minor",
            oldVersion: "0.1.0-alpha.5",
            newVersion: "0.1.0-alpha.6",
            changesets: ["cli-start"],
          },
        ],
      },
    });

    expect(report.ok).toBe(true);
    expect(report.nextAction).toContain("Changesets are present");
  });

  it("runs Changesets status in pending mode so mixed ignored package errors are visible", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      pending: true,
      entries: [{ status: "A", file: ".changeset/mixed.md" }],
      config: validConfig(),
      changesetSources: {
        ".changeset/mixed.md": `---
"@zitadel/api-mock": patch
"@zitadel/cli": patch
---

Keep private mocks aligned with public CLI behavior.
`,
      },
      runChangesetStatus: async () => {
        throw new Error("Found mixed changeset mixed: ignored @zitadel/api-mock and not ignored @zitadel/cli");
      },
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-changeset-package",
          message: expect.stringContaining("@zitadel/api-mock"),
        }),
        expect.objectContaining({
          code: "changeset-status",
          message: expect.stringContaining("Found mixed changeset"),
        }),
      ]),
    );
  });

  it("rejects changesets that reference unknown or private packages", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [{ status: "A", file: ".changeset/private-package.md" }],
      config: validConfig(),
      changesetSources: {
        ".changeset/private-package.md": `---
"@zitadel/api-mock": patch
---

This package is private.
`,
      },
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-changeset-package",
          message: expect.stringContaining("@zitadel/api-mock"),
        }),
      ]),
    );
  });

  it("rejects a fixed alpha group that omits server platform packages", async () => {
    const { checkChangesetsStatus, publicPackages } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [{ status: "M", file: "docs/release.md" }],
      config: {
        fixed: [publicPackages.map((pkg) => pkg.name).filter((name) => name !== "@zitadel/server-linux-x64")],
      },
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "fixed-group",
          message: expect.stringContaining("@zitadel/server-linux-x64"),
        }),
      ]),
    );
  });

  it("passes a version PR with no pending changeset files", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [
        { status: "D", file: ".changeset/cli-start.md" },
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "packages/sdk-core/CHANGELOG.md" },
        { status: "M", file: "pnpm-lock.yaml" },
      ],
      config: validConfig(),
    });

    expect(report.ok).toBe(true);
    expect(report.analysis.versionOnly).toBe(true);
    expect(report.nextAction).toContain("Version PR output detected");
  });

  it("passes generated version PR output without deleted changeset files in version PR mode", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      versionPr: true,
      entries: [
        { status: "M", file: ".changeset/pre.json" },
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "apps/cli/CHANGELOG.md" },
        { status: "M", file: "packages/sdk-core/package.json" },
        { status: "M", file: "packages/sdk-core/CHANGELOG.md" },
      ],
      config: validConfig(),
    });

    expect(report.ok).toBe(true);
    expect(report.analysis.versionOnly).toBe(true);
    expect(report.nextAction).toContain("Version PR output detected");
  });

  it("does not treat package and changelog edits as version output outside version PR mode", async () => {
    const { checkChangesetsStatus } = await loadModule();
    const report = await checkChangesetsStatus({
      entries: [
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "apps/cli/CHANGELOG.md" },
      ],
      config: validConfig(),
    });

    expect(report.ok).toBe(false);
    expect(report.analysis.versionOnly).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-changeset",
        }),
      ]),
    );
  });
});

describe("release-automation", () => {
  it("runs publish for a valid Changesets version package commit", async () => {
    const { detectReleaseAutomation } = await loadReleaseAutomationModule();
    const result = await detectReleaseAutomation({
      mode: "publish",
      message: "build: version packages (alpha)\n",
      pendingChangesets: [],
      entries: [
        { status: "M", file: ".changeset/pre.json" },
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "apps/cli/CHANGELOG.md" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.shouldRun).toBe(true);
  });

  it("runs publish for a prerelease version commit with recorded pending changesets", async () => {
    const { detectReleaseAutomation } = await loadReleaseAutomationModule();
    const result = await detectReleaseAutomation({
      mode: "publish",
      message: "build: version packages (alpha)\n",
      pendingChangesets: [".changeset/cli-start.md"],
      prereleaseChangesetIds: ["cli-start"],
      entries: [
        { status: "M", file: ".changeset/pre.json" },
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "apps/cli/CHANGELOG.md" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.shouldRun).toBe(true);
  });

  it("ignores unrecorded empty changesets when publishing a version package commit", async () => {
    const { detectReleaseAutomation } = await loadReleaseAutomationModule();
    const result = await detectReleaseAutomation({
      mode: "publish",
      message: "build: version packages (alpha)\n",
      pendingChangesets: [".changeset/release-tests.md"],
      releasePendingChangesets: [],
      entries: [
        { status: "M", file: ".changeset/pre.json" },
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "apps/cli/CHANGELOG.md" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.shouldRun).toBe(true);
  });

  it("skips publish for ordinary main commits", async () => {
    const { detectReleaseAutomation } = await loadReleaseAutomationModule();
    const result = await detectReleaseAutomation({
      mode: "publish",
      message: "feat: update cli start\n",
      pendingChangesets: [],
      entries: [
        { status: "M", file: "apps/cli/src/commands/start.ts" },
        { status: "A", file: ".changeset/cli-start.md" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.shouldRun).toBe(false);
  });

  it("skips publish for version package commits with only empty changeset output", async () => {
    const { detectReleaseAutomation } = await loadReleaseAutomationModule();
    const result = await detectReleaseAutomation({
      mode: "publish",
      message: "build: version packages (alpha)\n",
      pendingChangesets: [],
      entries: [{ status: "D", file: ".changeset/release-tests.md" }],
    });

    expect(result.ok).toBe(true);
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toContain("no publishable package version output");
  });

  it("fails publish when a version package commit changes non-version files", async () => {
    const { detectReleaseAutomation } = await loadReleaseAutomationModule();
    const result = await detectReleaseAutomation({
      mode: "publish",
      message: "build: version packages (alpha)\n",
      pendingChangesets: [],
      entries: [
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "docs/release.md" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.shouldRun).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("outside Changesets version output")]),
    );
  });

  it("fails publish when a version package commit leaves unrecorded pending changesets", async () => {
    const { detectReleaseAutomation } = await loadReleaseAutomationModule();
    const result = await detectReleaseAutomation({
      mode: "publish",
      message: "build: version packages (alpha)\n",
      pendingChangesets: [".changeset/cli-start.md", ".changeset/sdk-start.md"],
      prereleaseChangesetIds: ["cli-start"],
      entries: [
        { status: "M", file: ".changeset/pre.json" },
        { status: "M", file: "apps/cli/package.json" },
        { status: "M", file: "apps/cli/CHANGELOG.md" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.shouldRun).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining(".changeset/sdk-start.md")]),
    );
  });
});

describe("release publish guard", () => {
  it("fails manual non-dry publish skips instead of silently succeeding", async () => {
    const { shouldFailManualPublishSkip } = await loadReleaseModule();
    const workflowDispatchEnv = { GITHUB_EVENT_NAME: "workflow_dispatch" } as NodeJS.ProcessEnv;

    expect(shouldFailManualPublishSkip({ dryRun: false, recoverVersion: "" }, workflowDispatchEnv)).toBe(
      true,
    );
    expect(shouldFailManualPublishSkip({ dryRun: true, recoverVersion: "" }, workflowDispatchEnv)).toBe(
      false,
    );
    expect(
      shouldFailManualPublishSkip(
        { dryRun: false, recoverVersion: "0.1.0-alpha.14" },
        workflowDispatchEnv,
      ),
    ).toBe(false);
    expect(
      shouldFailManualPublishSkip({ dryRun: false, recoverVersion: "" }, {
        GITHUB_EVENT_NAME: "push",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("forces production telemetry while publishing npm packages", async () => {
    const { releasePublishEnv } = await loadReleaseModule();
    const originalBase = process.env.ZITADEL_RELEASE_TEST_BASE;
    process.env.ZITADEL_RELEASE_TEST_BASE = "preserved";
    try {
      const env = releasePublishEnv({
        ZITADEL_RELEASE_TEST_OVERRIDE: "included",
        ZITADEL_TELEMETRY_BUILD_CHANNEL: "development",
      });

      expect(env.ZITADEL_RELEASE_TEST_BASE).toBe("preserved");
      expect(env.ZITADEL_RELEASE_TEST_OVERRIDE).toBe("included");
      expect(env.ZITADEL_TELEMETRY_BUILD_CHANNEL).toBe("production");
    } finally {
      if (originalBase === undefined) {
        delete process.env.ZITADEL_RELEASE_TEST_BASE;
      } else {
        process.env.ZITADEL_RELEASE_TEST_BASE = originalBase;
      }
    }
  });

  it("allows prerelease-recorded pending changesets and rejects unrecorded ones", async () => {
    const { assertNoUnrecordedPendingChangesets } = await loadReleaseModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-guard-"));
    try {
      await mkdir(join(repoRoot, ".changeset"));
      await writeFile(
        join(repoRoot, ".changeset", "cli-start.md"),
        `---
"@zitadel/cli": patch
---
`,
      );
      await writeFile(
        join(repoRoot, ".changeset", "pre.json"),
        JSON.stringify({ mode: "pre", changesets: ["cli-start"] }),
      );

      await expect(assertNoUnrecordedPendingChangesets(repoRoot)).resolves.toBeUndefined();

      await writeFile(join(repoRoot, ".changeset", "empty-ci.md"), "---\n---\n");
      await expect(assertNoUnrecordedPendingChangesets(repoRoot)).resolves.toBeUndefined();

      await writeFile(
        join(repoRoot, ".changeset", "sdk-start.md"),
        `---
"@zitadel/sdk-core": patch
---
`,
      );
      await expect(assertNoUnrecordedPendingChangesets(repoRoot)).rejects.toThrow("sdk-start");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

function validConfig(): { fixed: string[][] } {
  return {
    fixed: [[...releaseManifest.PUBLIC_PACKAGE_NAMES]],
  };
}
