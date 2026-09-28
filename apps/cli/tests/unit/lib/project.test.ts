import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  hasZitadelConfig,
  hasZitadelSecret,
  readZitadelConfig,
  readZitadelSecret,
  writeZitadelSecret,
} from "../../../src/lib/project";
import { ZitadelError } from "../../../src/lib/errors";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-shared-test-"));
  tempDirs.push(dir);
  return dir;
}

const VALID_SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: ["https://example.test"],
  created_at: "2026-01-01T00:00:00.000Z",
};

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("hasZitadelConfig", () => {
  it("is true when zitadel.json exists, false otherwise", async () => {
    const cwd = await makeTempDir();
    expect(await hasZitadelConfig(cwd)).toBe(false);
    await writeFile(join(cwd, "zitadel.json"), "{}");
    expect(await hasZitadelConfig(cwd)).toBe(true);
  });
});

describe("hasZitadelSecret", () => {
  it("is true only when .zitadel/secret exists", async () => {
    const cwd = await makeTempDir();
    expect(await hasZitadelSecret(cwd)).toBe(false);
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    expect(await hasZitadelSecret(cwd)).toBe(false);
    await writeFile(join(cwd, ".zitadel", "secret"), "shh");
    expect(await hasZitadelSecret(cwd)).toBe(true);
  });
});

describe("readZitadelConfig", () => {
  it("round-trips a real zitadel.json file", async () => {
    const cwd = await makeTempDir();
    const config = { framework: "next", project_id: "proj-001" };
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify(config));

    await expect(readZitadelConfig(cwd)).resolves.toEqual(config);
  });

  it("throws an actionable E_VALIDATION error when the file is missing", async () => {
    const cwd = await makeTempDir();
    try {
      await readZitadelConfig(cwd);
      expect.unreachable("expected readZitadelConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ZitadelError);
      const zerr = error as ZitadelError;
      expect(zerr.code).toBe("E_VALIDATION");
      expect(zerr.message).toContain("zitadel.json was not found");
      expect(zerr.hint).toBe("Run `zitadel setup` first.");
      expect(zerr.nextCommands).toEqual(["zitadel setup"]);
    }
  });

  it("propagates malformed-JSON errors unchanged (not wrapped as not-found)", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), "{ not valid json");

    await expect(readZitadelConfig(cwd)).rejects.toThrow();
    await expect(readZitadelConfig(cwd)).rejects.not.toBeInstanceOf(ZitadelError);
  });

  it("rejects a non-object JSON root via parseJsonObject", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify([1, 2, 3]));

    await expect(readZitadelConfig(cwd)).rejects.toThrow("must contain a JSON object");
  });
});

describe("readZitadelSecret", () => {
  it("round-trips a real .zitadel/secret file", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(VALID_SECRET));

    await expect(readZitadelSecret(cwd)).resolves.toEqual(VALID_SECRET);
  });

  it("throws an actionable E_VALIDATION error when the file is missing", async () => {
    const cwd = await makeTempDir();
    try {
      await readZitadelSecret(cwd);
      expect.unreachable("expected readZitadelSecret to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ZitadelError);
      const zerr = error as ZitadelError;
      expect(zerr.code).toBe("E_VALIDATION");
      expect(zerr.message).toContain(".zitadel/secret was not found");
      expect(zerr.hint).toContain("zitadel doctor --fix");
      expect(zerr.nextCommands).toEqual(["zitadel setup", "zitadel doctor --fix"]);
    }
  });

  it("throws when a required string field is missing", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    const { project_secret: _omit, ...partial } = VALID_SECRET;
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(partial));

    await expect(readZitadelSecret(cwd)).rejects.toThrow(
      ".zitadel/secret is missing required fields",
    );
  });

  it("throws when preview_origins is not an array", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({ ...VALID_SECRET, preview_origins: "nope" }),
    );

    await expect(readZitadelSecret(cwd)).rejects.toThrow(
      ".zitadel/secret is missing required fields",
    );
  });

  it("propagates malformed-JSON errors unchanged (not wrapped as not-found)", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), "{ broken");

    await expect(readZitadelSecret(cwd)).rejects.toThrow();
    await expect(readZitadelSecret(cwd)).rejects.not.toBeInstanceOf(ZitadelError);
  });
});

describe("writeZitadelSecret", () => {
  async function seed(cwd: string, extra: Record<string, unknown> = {}): Promise<void> {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ ...VALID_SECRET, ...extra }));
  }

  it("round-trips through readZitadelSecret", async () => {
    const cwd = await makeTempDir();
    await seed(cwd);

    const secret = await readZitadelSecret(cwd);
    await writeZitadelSecret(cwd, {
      ...secret,
      claimed_at: "2026-02-02T00:00:00.000Z",
      team_id: "team-42",
    });

    await expect(readZitadelSecret(cwd)).resolves.toEqual({
      ...VALID_SECRET,
      claimed_at: "2026-02-02T00:00:00.000Z",
      team_id: "team-42",
    });
  });

  it("preserves keys it does not know about", async () => {
    const cwd = await makeTempDir();
    await seed(cwd, { future_field: { nested: true } });

    const secret = await readZitadelSecret(cwd);
    await writeZitadelSecret(cwd, { ...secret, team_id: "team-42" });

    const written = await readZitadelSecret(cwd);
    expect(written).toMatchObject({ future_field: { nested: true }, team_id: "team-42" });
  });

  it("writes at 0600 and leaves no temp file behind", async () => {
    const cwd = await makeTempDir();
    await seed(cwd);

    await writeZitadelSecret(cwd, await readZitadelSecret(cwd));

    const mode = (await stat(join(cwd, ".zitadel/secret"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readdir(join(cwd, ".zitadel"))).toEqual(["secret"]);
  });

  it("writes deterministic, newline-terminated JSON", async () => {
    const cwd = await makeTempDir();
    await seed(cwd);
    const secret = await readZitadelSecret(cwd);

    await writeZitadelSecret(cwd, secret);
    const first = await readFile(join(cwd, ".zitadel/secret"), "utf8");
    await writeZitadelSecret(cwd, { ...secret });
    const second = await readFile(join(cwd, ".zitadel/secret"), "utf8");

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
  });
});
