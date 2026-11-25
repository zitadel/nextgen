import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, vi } from "vitest";

import {
  LOCAL_ADMIN_EMAIL,
  LOCAL_ADMIN_FILE,
  LOCAL_ADMIN_USER_FILE,
  ensureLocalAdmin,
  findLocalAdminDir,
  findLocalAdminFor,
  readLocalAdmin,
} from "@/lib/server/local/admin-credential";
import { writeRuntimeMetadata } from "@/lib/server/local/runtime";
import { it } from "@tests/fixtures";

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

describe("local admin", () => {
  it("has no admin before start creates one", async ({ dir }) => {
    expect(await readLocalAdmin(dir)).toBeUndefined();
  });

  it("finds the admin in the directory start ran in, from there or from inside it", async ({
    dir: cwd,
  }) => {
    await ensureLocalAdmin(cwd);
    const nested = join(cwd, "apps", "web");
    await mkdir(nested, { recursive: true });

    expect(await findLocalAdminDir(cwd)).toBe(cwd);
    expect(await findLocalAdminDir(nested)).toBe(cwd);
  });

  it("finds no admin directory when none of the parents has one", async ({ dir: cwd }) => {
    // The search ends at the home directory; pinning it keeps the developer's
    // own `~/.zitadel/local` out of the test.
    vi.stubEnv("HOME", cwd);
    vi.stubEnv("USERPROFILE", cwd);

    expect(await findLocalAdminDir(cwd)).toBeUndefined();
  });

  it("gives a server the admin its own start created, under either loopback name", async ({
    dir: cwd,
  }) => {
    const { admin } = await ensureLocalAdmin(cwd);
    await recordStartedServer(cwd, "http://localhost:8081");
    const app = join(cwd, "my-app");
    await mkdir(app);

    expect(await findLocalAdminFor(app, "http://localhost:8081")).toEqual(admin);
    expect(await findLocalAdminFor(app, "http://127.0.0.1:8081")).toEqual(admin);
  });

  it("gives a server no admin that another server's start created", async ({ dir: cwd }) => {
    vi.stubEnv("HOME", cwd);
    vi.stubEnv("USERPROFILE", cwd);
    await ensureLocalAdmin(cwd);
    await recordStartedServer(cwd, "http://localhost:8081");

    expect(await findLocalAdminFor(cwd, "http://localhost:9000")).toBeUndefined();
  });

  it("looks past another server's admin to the right one further up", async ({ dir: outer }) => {
    const { admin } = await ensureLocalAdmin(outer);
    await recordStartedServer(outer, "http://localhost:8081");
    const inner = join(outer, "sandbox");
    await mkdir(inner);
    await ensureLocalAdmin(inner);
    await recordStartedServer(inner, "http://localhost:9000");

    expect(await findLocalAdminFor(inner, "http://localhost:8081")).toEqual(admin);
  });

  it("creates the credential and its bootstrap user document", async ({ dir: cwd }) => {
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

    expect(doc.authenticators.password.encoded_hash).toBeTruthy();
    expect(doc.authenticators.password.change_required).toBe(false);
  });

  it("names a malformed credential by kind, for the command to advise on", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, LOCAL_ADMIN_FILE), "{ truncated");

    const error = await readLocalAdmin(cwd).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "E_VALIDATION",
      name: "LocalServerInvalidError",
    });
  });

  // A credential that exists but cannot be read is still the one the server
  // imported; minting a replacement would split the password in two.
  it.skipIf(process.getuid?.() === 0)(
    "refuses an unreadable credential instead of replacing it",
    async ({ dir: cwd }) => {
      const { admin } = await ensureLocalAdmin(cwd);
      await chmod(join(cwd, LOCAL_ADMIN_FILE), 0o000);

      try {
        await expect(ensureLocalAdmin(cwd)).rejects.toMatchObject({
          code: "E_VALIDATION",
          name: "LocalServerInvalidError",
          message: expect.stringMatching(/cannot be read/),
        });
      } finally {
        await chmod(join(cwd, LOCAL_ADMIN_FILE), 0o600);
      }
      expect(await readLocalAdmin(cwd)).toEqual(admin);
    },
  );

  it("names the schema under the server's configured schema base", async ({ dir: cwd }) => {
    const { userFile } = await ensureLocalAdmin(cwd, "https://schemas.example.test/api/schemas/");

    const doc = JSON.parse(await readFile(userFile, "utf8")) as { header: { schema_url: string } };
    expect(doc.header.schema_url).toBe(
      "https://schemas.example.test/api/schemas/default-human-user.json",
    );
  });

  it("replaces the bootstrap document without leaving a staging file behind", async ({
    dir: cwd,
  }) => {
    await ensureLocalAdmin(cwd);
    await ensureLocalAdmin(cwd);

    const entries = await readdir(join(cwd, ".zitadel/local"));
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the same credential on later starts", async ({ dir: cwd }) => {
    const first = await ensureLocalAdmin(cwd);
    const second = await ensureLocalAdmin(cwd);

    expect(second.admin).toEqual(first.admin);
    expect(await readLocalAdmin(cwd)).toEqual(first.admin);
  });

  // Two starts in one directory must not each mint a password: the server would
  // import one hash while the CLI kept the other credential, and every console
  // handoff would fail.
  it("mints one credential when two starts race", async ({ dir: cwd }) => {
    const [first, second] = await Promise.all([ensureLocalAdmin(cwd), ensureLocalAdmin(cwd)]);

    const stored = await readLocalAdmin(cwd);
    expect(first.admin).toEqual(stored);
    expect(second.admin).toEqual(stored);
  });
});
