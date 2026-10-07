import { pbkdf2Sync } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_ADMIN_EMAIL,
  LOCAL_ADMIN_FILE,
  LOCAL_ADMIN_USER_FILE,
  ensureLocalAdmin,
  findLocalAdminDir,
  findLocalAdminFor,
  readLocalAdmin,
} from "../../../../src/lib/local-server/admin-credential";
import { writeRuntimeMetadata } from "../../../../src/lib/local-server/runtime";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
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

/** What `zitadel start` records beside the local admin: which server it started. */
async function recordStartedServer(dir: string, serverUrl: string): Promise<void> {
  await writeRuntimeMetadata(dir, {
    schema_version: 1,
    backend: "docker",
    container_name: "zitadel-server-test",
    container_id: "container-1",
    image: "ghcr.io/zitadel/nextgen:test",
    port: Number(new URL(serverUrl).port),
    server_url: serverUrl,
    data_dir: join(dir, ".zitadel/local/nextgen-data"),
    created_at: "2026-06-09T00:00:00.000Z",
    cli_version: "0.0.0-test",
  });
}

/** Decodes passlib's adapted base64 (`.` for `+`, no padding). */
function ab64Decode(value: string): Buffer {
  return Buffer.from(value.replaceAll(".", "+"), "base64");
}

describe("local admin", () => {
  it("has no admin before start creates one", async () => {
    expect(await readLocalAdmin(await tempCwd())).toBeUndefined();
  });

  it("finds the admin in the directory start ran in, from there or from inside it", async () => {
    const cwd = await tempCwd();
    await ensureLocalAdmin(cwd);
    const nested = join(cwd, "apps", "web");
    await mkdir(nested, { recursive: true });

    expect(await findLocalAdminDir(cwd)).toBe(cwd);
    expect(await findLocalAdminDir(nested)).toBe(cwd);
  });

  it("finds no admin directory when none of the parents has one", async () => {
    const cwd = await tempCwd();
    // The search ends at the home directory; pinning it keeps the developer's
    // own `~/.zitadel/local` out of the test.
    vi.stubEnv("HOME", cwd);
    vi.stubEnv("USERPROFILE", cwd);

    expect(await findLocalAdminDir(cwd)).toBeUndefined();
  });

  it("gives a server the admin its own start created, under either loopback name", async () => {
    const cwd = await tempCwd();
    const { admin } = await ensureLocalAdmin(cwd);
    await recordStartedServer(cwd, "http://localhost:8081");
    const app = join(cwd, "my-app");
    await mkdir(app);

    expect(await findLocalAdminFor(app, "http://localhost:8081")).toEqual(admin);
    expect(await findLocalAdminFor(app, "http://127.0.0.1:8081")).toEqual(admin);
  });

  it("gives a server no admin that another server's start created", async () => {
    const cwd = await tempCwd();
    vi.stubEnv("HOME", cwd);
    vi.stubEnv("USERPROFILE", cwd);
    await ensureLocalAdmin(cwd);
    await recordStartedServer(cwd, "http://localhost:8081");

    expect(await findLocalAdminFor(cwd, "http://localhost:9000")).toBeUndefined();
  });

  it("looks past another server's admin to the right one further up", async () => {
    const outer = await tempCwd();
    const { admin } = await ensureLocalAdmin(outer);
    await recordStartedServer(outer, "http://localhost:8081");
    const inner = join(outer, "sandbox");
    await mkdir(inner);
    await ensureLocalAdmin(inner);
    await recordStartedServer(inner, "http://localhost:9000");

    expect(await findLocalAdminFor(inner, "http://localhost:8081")).toEqual(admin);
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
    const recomputed = pbkdf2Sync(
      admin.password,
      ab64Decode(salt ?? ""),
      Number(rounds),
      32,
      "sha256",
    );
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

  // A credential that exists but cannot be read is still the one the server
  // imported; minting a replacement would split the password in two.
  it.skipIf(process.getuid?.() === 0)(
    "refuses an unreadable credential instead of replacing it",
    async () => {
      const cwd = await tempCwd();
      const { admin } = await ensureLocalAdmin(cwd);
      await chmod(join(cwd, LOCAL_ADMIN_FILE), 0o000);

      try {
        await expect(ensureLocalAdmin(cwd)).rejects.toThrow(/cannot be read/);
      } finally {
        await chmod(join(cwd, LOCAL_ADMIN_FILE), 0o600);
      }
      expect(await readLocalAdmin(cwd)).toEqual(admin);
    },
  );

  it("names the schema under the server's configured schema base", async () => {
    const cwd = await tempCwd();

    const { userFile } = await ensureLocalAdmin(cwd, "https://schemas.example.test/api/schemas/");

    const doc = JSON.parse(await readFile(userFile, "utf8")) as { header: { schema_url: string } };
    expect(doc.header.schema_url).toBe(
      "https://schemas.example.test/api/schemas/default-human-user.json",
    );
  });

  it("replaces the bootstrap document without leaving a staging file behind", async () => {
    const cwd = await tempCwd();

    await ensureLocalAdmin(cwd);
    await ensureLocalAdmin(cwd);

    const entries = await readdir(join(cwd, ".zitadel/local"));
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
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
