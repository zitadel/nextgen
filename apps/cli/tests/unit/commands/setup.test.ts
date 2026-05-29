import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const tempDirs: string[] = [];

function setup(cwd: string, extra: string[] = []) {
  return runCliForTest([
    "setup",
    "--cwd",
    cwd,
    "--json",
    "--server",
    "https://api.zitadel.cloud",
    ...extra,
  ]);
}

/** A minimal detectable Next.js App Router project (no Zitadel files yet). */
async function makeNextProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
  );
  await writeFile(join(cwd, "app/layout.tsx"), "export default function L() {}\n");
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

describe("setup command", () => {
  it("skips when the project is already initialized", async () => {
    const cwd = await makeNextProject();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "existing" }));

    const res = await setup(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("already-initialized");
  });

  it("errors with E_CONFLICT when a secret exists without zitadel.json", async () => {
    const cwd = await makeNextProject();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), "{}");

    const res = await setup(cwd);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CONFLICT");
  });

  it("dry-run returns ok with a stub project and contacts no platform", async () => {
    const cwd = await makeNextProject();

    const res = await setup(cwd, ["--dry-run", "--no-apply", "--framework", "next"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { project: { project_id: string }; apply?: unknown };
    };
    expect(json.status).toBe("ok");
    expect(json.data.project.project_id).toBe("dry-run-0000");
    // dry-run never applies, so no apply summary is attached.
    expect(json.data.apply).toBeUndefined();
  });

  it("errors in a non-interactive empty directory without --framework", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-empty-"));
    tempDirs.push(cwd);

    const res = await setup(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
  });
});
