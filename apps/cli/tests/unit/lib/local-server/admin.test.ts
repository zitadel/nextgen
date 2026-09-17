import { pbkdf2Sync } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
    // Both files hold credential material: owner-only.
    expect((await stat(join(cwd, LOCAL_ADMIN_FILE))).mode & 0o777).toBe(0o600);
    expect((await stat(userFile)).mode & 0o777).toBe(0o600);

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

  it("keeps the same credential on later starts", async () => {
    const cwd = await tempCwd();

    const first = await ensureLocalAdmin(cwd);
    const second = await ensureLocalAdmin(cwd);

    expect(second.admin).toEqual(first.admin);
    expect(await readLocalAdmin(cwd)).toEqual(first.admin);
  });
});
