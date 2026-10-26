import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureLocalAdmin } from "../../../src/lib/local-server/admin-credential";
import { LOCAL_DATA_DIR, writeRuntimeMetadata } from "../../../src/lib/local-server/runtime";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "../../helpers/run-cli";
import { aBinaryRecord } from "../../helpers/runtime-record";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("console", () => {
  it("points at `zitadel start` when no local admin exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-console-"));
    tempDirs.push(cwd);

    const res = await runCliForTest(["console", "--cwd", cwd, "--json", "--no-open"], {
      HOME: cwd,
      USERPROFILE: cwd,
    });

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      status: string;
      code: string;
      message: string;
      next_commands: string[];
    };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe("No local admin in this directory or its parents");
    expect(json.next_commands.at(-1)).toMatch(/ start --cwd \S+$/);
  });

  it("refuses a local server another CLI release started, and suggests start, then itself", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-console-"));
    tempDirs.push(cwd);
    await ensureLocalAdmin(cwd);
    await writeRuntimeMetadata(
      cwd,
      aBinaryRecord({
        pid: process.pid,
        command: process.execPath,
        server_version: "0.0.1",
        data_dir: join(cwd, LOCAL_DATA_DIR),
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );

    const res = await runCliForTest(["console", "--cwd", cwd, "--json", "--no-open"]);

    expect(res.exitCode).toBe(5);
    const json = parseJson(res.stdout) as { code: string; next_commands: string[] };
    expect(json.code).toBe("E_CONFLICT");
    expect(json.next_commands).toEqual([
      expectedPublicCliCommand(`start --cwd ${cwd}`),
      expectedPublicCliCommand(`console --cwd ${cwd}`),
    ]);
  });

  it("signs in as the admin of a parent directory when run from an app inside it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "zitadel-console-"));
    tempDirs.push(parent);
    const { admin } = await ensureLocalAdmin(parent);
    const app = join(parent, "my-app");
    await mkdir(app);

    const res = await runCliForTest(["console", "--cwd", app, "--json", "--dry-run"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { signed_in_as: string } };
    expect(json.data.signed_in_as).toBe(admin.email);
  });
});
