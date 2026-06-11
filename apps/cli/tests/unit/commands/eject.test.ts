import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";
import { MANAGED_MARKER } from "../../../src/lib/paths";

function eject(cwd: string, extra: string[] = []) {
  return runCliForTest([
    "eject",
    "--cwd",
    cwd,
    "--json",
    "--server",
    "https://api.zitadel.cloud",
    ...extra,
  ]);
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

describe("eject command", () => {
  it("refuses to run without --force in non-interactive mode", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    // Nothing should have been removed.
    expect(await exists(join(cwd, "zitadel.json"))).toBe(true);
    expect(await exists(join(cwd, ".zitadel"))).toBe(true);
  });

  it("removes managed files and the .zitadel dir when forced", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd, ["--force"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        files_removed: string[];
        files_preserved: string[];
        backed_up: string[];
        next_commands: string[];
      };
    };
    expect(json.status).toBe("ok");
    // The CLI doesn't touch package.json (lockfile + other deps), but suggests
    // the user uninstall the SDK package the patcher added.
    expect(json.data.next_commands).toContain("npm uninstall @zitadel/sdk-next");

    // Managed files and config/state are gone.
    expect(json.data.files_removed).toContain("zitadel.json");
    expect(json.data.files_removed).toContain("app/login/page.tsx");
    expect(await exists(join(cwd, "zitadel.json"))).toBe(false);
    expect(await exists(join(cwd, "app/login/page.tsx"))).toBe(false);
    // The whole .zitadel directory is removed wholesale.
    expect(await exists(join(cwd, ".zitadel"))).toBe(false);

    // The unmanaged register page is preserved.
    expect(json.data.files_preserved).toContain("app/register/page.tsx");
    expect(await exists(join(cwd, "app/register/page.tsx"))).toBe(true);

    // .env.local is renamed to a timestamped backup, not deleted.
    expect(json.data.backed_up.length).toBe(1);
    expect(await exists(join(cwd, ".env.local"))).toBe(false);
    const entries = await readdir(cwd);
    expect(entries.some((name) => name.startsWith(".env.local.ejected-"))).toBe(true);
  });

  it("reports what would be removed in dry-run without touching the filesystem", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd, ["--force", "--dry-run"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { files_removed: string[]; backed_up: string[] };
    };
    expect(json.data.files_removed).toContain("zitadel.json");
    // Dry-run must still preview the .env.local backup, not silently omit it.
    expect(json.data.backed_up.some((entry) => entry.startsWith(".env.local"))).toBe(true);

    // Dry-run leaves everything in place.
    expect(await exists(join(cwd, "zitadel.json"))).toBe(true);
    expect(await exists(join(cwd, ".zitadel"))).toBe(true);
    expect(await exists(join(cwd, ".env.local"))).toBe(true);
  });

  it("emits a skipped envelope when there is nothing to eject", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-empty-"));
    tempDirs.push(cwd);

    const res = await eject(cwd, ["--force"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("nothing-to-eject");
  });
});
