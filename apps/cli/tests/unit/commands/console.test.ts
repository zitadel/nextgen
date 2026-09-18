import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("console", () => {
  it("points at `zitadel start` when no local admin exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-console-"));
    tempDirs.push(cwd);

    const res = await runCliForTest(["console", "--cwd", cwd, "--json", "--no-open"]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      message: string;
      next_commands: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("No local admin");
    expect(json.next_commands.at(-1)).toMatch(/ start$/);
  });

  it("refuses a --server it could not honour", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-console-"));
    tempDirs.push(cwd);

    const res = await runCliForTest([
      "console",
      "--cwd",
      cwd,
      "--server",
      "https://example.com",
      "--json",
      "--no-open",
    ]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("--server");
  });
});
