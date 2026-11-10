import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import config from "../../../vitest.config";
import { PORT_WORKERS } from "@tests/helpers/ports";
import { ownerIsAlive, staleFakeServers } from "@tests/helpers/stale-servers";

const LEFT_BEHIND =
  "87289     1 node /var/folders/zb/T/zitadel-fake-server-vjZmOm/nextgen --user-file /x/admin-user.json --migrate";
const IN_USE =
  "91000     1 node /var/folders/zb/T/zitadel-fake-server-aBcDeF/nextgen --user-file /y/admin-user.json";
const UNRELATED = "  500     1 /usr/sbin/cupsd -l";
const owned = (serverDir: string) => serverDir.endsWith("aBcDeF");

describe("staleFakeServers", () => {
  it("names a fake server whose owner is gone", () => {
    expect(staleFakeServers(LEFT_BEHIND, owned)).toEqual([87289]);
  });

  it("leaves a fake server whose owner is still running, even with PID 1 as its parent", () => {
    expect(staleFakeServers(IN_USE, owned)).toEqual([]);
  });

  it("leaves a process that is not a fake server", () => {
    expect(staleFakeServers(UNRELATED, owned)).toEqual([]);
  });

  it("finds each stale server among other processes", () => {
    const ps = [UNRELATED, LEFT_BEHIND, IN_USE, "", "not a ps line"].join("\n");

    expect(staleFakeServers(ps, owned)).toEqual([87289]);
  });
});

describe("ownerIsAlive", () => {
  const serverDirOwnedBy = async (owner: string | undefined) => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-owner-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    if (owner !== undefined) {
      await writeFile(join(dir, "owner"), owner);
    }
    return dir;
  };

  it("is true for a process that is running", async () => {
    expect(ownerIsAlive(await serverDirOwnedBy(String(process.pid)))).toBe(true);
  });

  it("is false for a process that has ended", async () => {
    const ended = spawnSync(process.execPath, ["-e", ""]).pid;

    expect(ownerIsAlive(await serverDirOwnedBy(String(ended)))).toBe(false);
  });

  it("is false when no owner was recorded", async () => {
    expect(ownerIsAlive(await serverDirOwnedBy(undefined))).toBe(false);
  });
});

describe("the vitest config", () => {
  it("sweeps stale fake servers before any test runs", () => {
    expect(config.test?.globalSetup).toContain("./tests/helpers/stale-servers.ts");
  });

  it("takes three quarters of the cores and never outnumbers the port blocks", () => {
    expect(config.test?.maxWorkers).toBe(
      Math.min(Math.max(Math.floor((availableParallelism() * 3) / 4), 1), PORT_WORKERS),
    );
  });
});
