import { describe, expect, it } from "vitest";

type CiModeModule = {
  detectCiMode: (files: string[]) => { mode: "full" | "version-only"; deploySmoke: boolean };
  isVersionOutputFile: (file: string) => boolean;
  isDeploySurfaceFile: (file: string) => boolean;
};

async function loadModule(): Promise<CiModeModule> {
  return (await import(
    new URL("../../../../../scripts/ci-mode.mjs", import.meta.url).href
  )) as CiModeModule;
}

describe("ci mode detection", () => {
  it("detects version-only PRs from Changesets version output and always smokes them", async () => {
    const { detectCiMode } = await loadModule();

    expect(
      detectCiMode([
        ".changeset/pre.json",
        "apps/server/package.json",
        "apps/cli/CHANGELOG.md",
        "pnpm-lock.yaml",
      ]),
    ).toEqual({ mode: "version-only", deploySmoke: true });
  });

  it("keeps regular code PRs in full mode without the deployment smoke", async () => {
    const { detectCiMode } = await loadModule();

    expect(detectCiMode(["internal/api/health.go", "apps/cli/src/commands/start.ts"])).toEqual({
      mode: "full",
      deploySmoke: false,
    });
    expect(detectCiMode([])).toEqual({ mode: "full", deploySmoke: false });
  });

  it("adds the deployment smoke when the diff touches the deploy surface", async () => {
    const { detectCiMode, isDeploySurfaceFile } = await loadModule();

    for (const file of [
      "Dockerfile",
      "docs/operations/docker-compose.yaml",
      "examples/bootstrap-users/demo-admin.json",
      "scripts/release-npm.mjs",
      "scripts/deploy-smoke.mjs",
      "scripts/ci-mode.mjs",
      "tools/release/moon.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/release-publish.yml",
    ]) {
      expect(isDeploySurfaceFile(file), file).toBe(true);
      expect(detectCiMode([file, "internal/api/health.go"])).toEqual({
        mode: "full",
        deploySmoke: true,
      });
    }

    expect(isDeploySurfaceFile("scripts/check.mjs")).toBe(false);
    expect(isDeploySurfaceFile("docs/adrs/002-multi-package-release-strategy.md")).toBe(false);
  });

  it("classifies version output files like the version PR produces", async () => {
    const { isVersionOutputFile } = await loadModule();

    expect(isVersionOutputFile(".changeset/nice-pandas-drum.md")).toBe(true);
    expect(isVersionOutputFile("packages/api/package.json")).toBe(true);
    expect(isVersionOutputFile("packages/api/CHANGELOG.md")).toBe(true);
    expect(isVersionOutputFile("pnpm-lock.yaml")).toBe(true);
    expect(isVersionOutputFile("apps/cli/src/index.ts")).toBe(false);
  });
});
