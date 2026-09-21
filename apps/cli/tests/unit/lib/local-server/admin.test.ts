import { pbkdf2Sync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_ADMIN_EMAIL,
  LOCAL_ADMIN_FILE,
  LOCAL_ADMIN_USER_FILE,
  ensureLocalAdmin,
  readLocalAdmin,
} from "../../../../src/lib/local-server/admin";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function tempCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-admin-"));
  tempDirs.push(cwd);
  return cwd;
}

/** Decodes passlib's adapted base64 (`.` for `+`, no padding). */
function ab64Decode(value: string): Buffer {
  return Buffer.from(value.replaceAll(".", "+"), "base64");
}

describe("local admin", () => {
  it("has no admin before start creates one", async () => {
    expect(await readLocalAdmin(await tempCwd())).toBeUndefined();
  });

  it("creates the credential and a bootstrap user document the server can verify", async () => {
    const cwd = await tempCwd();

    const { admin, userFile } = await ensureLocalAdmin(cwd);

    // A fixed local identity, never inferred from Git config.
    expect(admin.email).toBe(LOCAL_ADMIN_EMAIL);
    expect(admin.password.length).toBeGreaterThanOrEqual(32);
    expect(userFile).toBe(join(cwd, LOCAL_ADMIN_USER_FILE));
    // The password lives here, so it stays owner-only.
    expect((await stat(join(cwd, LOCAL_ADMIN_FILE))).mode & 0o777).toBe(0o600);
    // The bootstrap document carries only a hash, and the docker runtime
    // mounts it into a container that may run as another user.
    expect((await stat(userFile)).mode & 0o777).toBe(0o644);

    const doc = JSON.parse(await readFile(userFile, "utf8")) as {
      header: Record<string, string>;
      attributes: Record<string, unknown>;
      authenticators: { password: { encoded_hash: string; change_required: boolean } };
    };
    expect(doc.header.project_id).toBe("proj_platform");
    expect(doc.header.id).toBe(admin.user_id);
    expect(doc.header.team_id).toBe(admin.team_id);
    // The bootstrap import requires these markers.
    expect(doc.attributes).toMatchObject({
      username: admin.email,
      email: admin.email,
      "zitadel.source": "cli",
      "zitadel.default_user": true,
    });
    // The document carries a hash, never the password itself.
    expect(JSON.stringify(doc)).not.toContain(admin.password);

    const [, id, rounds, salt, hash] = doc.authenticators.password.encoded_hash.split("$");
    expect(id).toBe("pbkdf2-sha256");
    const recomputed = pbkdf2Sync(admin.password, ab64Decode(salt ?? ""), Number(rounds), 32, "sha256");
    expect(recomputed.equals(ab64Decode(hash ?? ""))).toBe(true);
    expect(doc.authenticators.password.change_required).toBe(false);
  });

  // `zitadel reset` keeps admin.json and deleting the file alone orphans the
  // imported password, so the advice has to name both steps.
  it("points a malformed credential at deleting the file and resetting the data", async () => {
    const cwd = await tempCwd();
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, LOCAL_ADMIN_FILE), "{ truncated");

    const error = await readLocalAdmin(cwd).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "E_VALIDATION",
      nextCommands: [`rm ${LOCAL_ADMIN_FILE}`, "zitadel reset --force", "zitadel start"],
    });
    expect((error as { hint: string }).hint).toContain("Both are needed");
  });

  it("keeps the same credential on later starts", async () => {
    const cwd = await tempCwd();

    const first = await ensureLocalAdmin(cwd);
    const second = await ensureLocalAdmin(cwd);

    expect(second.admin).toEqual(first.admin);
    expect(await readLocalAdmin(cwd)).toEqual(first.admin);
  });

  // Two starts in one directory must not each mint a password: the server would
  // import one hash while the CLI kept the other credential, and every console
  // handoff would fail.
  it("mints one credential when two starts race", async () => {
    const cwd = await tempCwd();

    const [first, second] = await Promise.all([ensureLocalAdmin(cwd), ensureLocalAdmin(cwd)]);

    const stored = await readLocalAdmin(cwd);
    expect(first.admin).toEqual(stored);
    expect(second.admin).toEqual(stored);
  });
});
