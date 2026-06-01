import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../../helpers/run-cli";

/**
 * Unit-level guardrails for the `setup` command. The happy path
 * (project create + patch + apply round-trip) is covered by the
 * integration tests in `tests/integration/setup-next.test.ts`. The
 * cases here focus on the pre-flight branches that short-circuit
 * before any network or filesystem mutation, so they run without an
 * api-mock.
 */
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-test-"));
  tempDirs.push(cwd);
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

describe("setup command pre-flight", () => {
  it("emits status: skipped when zitadel.json already exists", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "proj_x" }));

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason?: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("already-initialized");
  });

  it("throws E_CONFLICT when .zitadel/secret exists without zitadel.json", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ project_id: "proj_x" }));

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CONFLICT");
  });

  it("throws E_FRAMEWORK_NOT_DETECTED for an empty dir when non-interactive without --framework", async () => {
    const cwd = await makeTempDir();

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string; hint?: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
    expect(json.hint).toContain("--framework");
  });

  it("throws E_FRAMEWORK_NOT_DETECTED for a non-empty dir whose framework can't be inferred", async () => {
    const cwd = await makeTempDir();
    // A non-empty dir that isn't a known framework — Orca's detector fails
    // and the empty-directory scaffold branch doesn't trigger.
    await writeFile(join(cwd, "README.md"), "Not a Next.js project.");

    const res = await runCliForTest(["setup", "--cwd", cwd, "--non-interactive", "--json"]);

    expect(res.exitCode).not.toBe(0);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_FRAMEWORK_NOT_DETECTED");
  });
});
