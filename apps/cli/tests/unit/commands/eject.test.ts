import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runEject } from "../../../src/commands/eject";
import type { GlobalOptions } from "../../../src/lib/oclif";
import { MANAGED_MARKER } from "../../../src/lib/paths";

function makeOpts(cwd: string, overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    cwd,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "eject",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    env: {},
    isTTY: false,
    ...overrides,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const tempDirs: string[] = [];

/**
 * Builds a managed project with the full set of files eject is expected to
 * touch: config/state/secret/schemas, a managed login page (with marker), an
 * unmanaged register page (no marker), and a .env.local.
 */
async function makeManagedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await mkdir(join(cwd, "app/login"), { recursive: true });
  await mkdir(join(cwd, "app/register"), { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
  );
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "proj-001" }));
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ project_id: "proj-001" }));
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify({ framework: "next" }));
  await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify({ type: "object" }));
  await writeFile(join(cwd, ".zitadel/flows/default.json"), JSON.stringify({ name: "default" }));
  await writeFile(join(cwd, "app/login/page.tsx"), `${MANAGED_MARKER}\nexport default function L() {}\n`);
  // Register page lacks the managed marker, so eject must preserve it.
  await writeFile(join(cwd, "app/register/page.tsx"), "export default function R() {}\n");
  await writeFile(join(cwd, ".env.local"), "ZITADEL_PROJECT_ID=proj-001\n");
  return cwd;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("runEject", () => {
  it("refuses to run without --force in non-interactive mode", async () => {
    const cwd = await makeManagedProject();
    await expect(runEject(makeOpts(cwd, { force: false }))).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
    // Nothing should have been removed.
    expect(await exists(join(cwd, "zitadel.json"))).toBe(true);
    expect(await exists(join(cwd, ".zitadel"))).toBe(true);
  });

  it("removes managed files and the .zitadel dir when forced", async () => {
    const cwd = await makeManagedProject();
    const result = await runEject(makeOpts(cwd, { force: true }));

    expect(result.status).toBe("ok");
    const data = result.data as {
      files_removed: string[];
      files_preserved: string[];
      backed_up: string[];
    };

    // Managed files and config/state are gone.
    expect(data.files_removed).toContain("zitadel.json");
    expect(data.files_removed).toContain("app/login/page.tsx");
    expect(await exists(join(cwd, "zitadel.json"))).toBe(false);
    expect(await exists(join(cwd, "app/login/page.tsx"))).toBe(false);
    // The whole .zitadel directory is removed wholesale.
    expect(await exists(join(cwd, ".zitadel"))).toBe(false);

    // The unmanaged register page is preserved.
    expect(data.files_preserved).toContain("app/register/page.tsx");
    expect(await exists(join(cwd, "app/register/page.tsx"))).toBe(true);

    // .env.local is renamed to a timestamped backup, not deleted.
    expect(data.backed_up.length).toBe(1);
    expect(await exists(join(cwd, ".env.local"))).toBe(false);
    const entries = await readdir(cwd);
    expect(entries.some((name) => name.startsWith(".env.local.ejected-"))).toBe(true);
  });

  it("reports what would be removed in dry-run without touching the filesystem", async () => {
    const cwd = await makeManagedProject();
    const result = await runEject(makeOpts(cwd, { force: true, dryRun: true }));

    expect(result.status).toBe("ok");
    const data = result.data as { files_removed: string[]; backed_up: string[] };
    expect(data.files_removed).toContain("zitadel.json");
    // Dry-run must still preview the .env.local backup, not silently omit it.
    expect(data.backed_up.some((entry) => entry.startsWith(".env.local"))).toBe(true);

    // Dry-run leaves everything in place.
    expect(await exists(join(cwd, "zitadel.json"))).toBe(true);
    expect(await exists(join(cwd, ".zitadel"))).toBe(true);
    expect(await exists(join(cwd, ".env.local"))).toBe(true);
  });

  it("emits a skipped envelope when there is nothing to eject", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-empty-"));
    tempDirs.push(cwd);

    const result = await runEject(makeOpts(cwd, { force: true }));

    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") {
      throw new Error("expected skipped");
    }
    expect(result.reason).toBe("nothing-to-eject");
  });
});
