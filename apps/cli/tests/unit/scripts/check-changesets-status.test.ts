import { describe, expect, it } from "vitest";

type CheckChangesetsStatusModule = {
  checkChangesetsStatus: (options: {
    base?: string;
    pending?: boolean;
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

async function loadModule(): Promise<CheckChangesetsStatusModule> {
  return (await import(
    new URL("../../../../../scripts/check-changesets-status.mjs", import.meta.url).href
  )) as CheckChangesetsStatusModule;
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
});

function validConfig(): { fixed: string[][] } {
  return {
    fixed: [
      [
        "@zitadel/cli",
        "@zitadel/server",
        "@zitadel/server-linux-x64",
        "@zitadel/server-linux-arm64",
        "@zitadel/server-darwin-x64",
        "@zitadel/server-darwin-arm64",
        "@zitadel/server-win32-x64",
        "@zitadel/api",
        "@zitadel/components",
        "@zitadel/sdk-core",
        "@zitadel/sdk-next",
        "@zitadel/sdk-nuxt",
        "@zitadel/sdk-react",
        "@zitadel/sdk-vue",
        "@zitadel/sdk-angular",
      ],
    ],
  };
}
