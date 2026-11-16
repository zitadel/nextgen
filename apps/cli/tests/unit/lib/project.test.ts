import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  hasZitadelConfig,
  hasZitadelSecret,
  readZitadelConfig,
  readZitadelSecret,
  writeZitadelSecret,
} from "@/lib/project";
import { ZitadelError } from "@/lib/errors";
import { it } from "@tests/helpers/fixtures";

const VALID_SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  primary_origins: [],
  preview_origins: ["https://example.test"],
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("hasZitadelConfig", () => {
  it("is true when zitadel.json exists, false otherwise", async ({ dir: cwd }) => {
    expect(await hasZitadelConfig(cwd)).toBe(false);
    await writeFile(join(cwd, "zitadel.json"), "{}");
    expect(await hasZitadelConfig(cwd)).toBe(true);
  });
});

describe("hasZitadelSecret", () => {
  it("is true only when .zitadel/secret exists", async ({ dir: cwd }) => {
    expect(await hasZitadelSecret(cwd)).toBe(false);
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    expect(await hasZitadelSecret(cwd)).toBe(false);
    await writeFile(join(cwd, ".zitadel", "secret"), "shh");
    expect(await hasZitadelSecret(cwd)).toBe(true);
  });
});

describe("readZitadelConfig", () => {
  it("round-trips a real zitadel.json file", async ({ dir: cwd }) => {
    const config = { framework: "next", project_id: "proj-001" };
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify(config));

    await expect(readZitadelConfig(cwd)).resolves.toEqual(config);
  });

  it("throws an actionable E_VALIDATION error when the file is missing", async ({ dir: cwd }) => {
    try {
      await readZitadelConfig(cwd);
      expect.unreachable("expected readZitadelConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ZitadelError);
      const zerr = error as ZitadelError;
      expect(zerr.code).toBe("E_VALIDATION");
      expect(zerr.message).toContain("zitadel.json was not found");
      expect(zerr.hint).toBe("Set the project up first.");
      expect(zerr.nextCommands).toEqual([{ id: "setup" }]);
    }
  });

  it("propagates malformed-JSON errors unchanged (not wrapped as not-found)", async ({
    dir: cwd,
  }) => {
    await writeFile(join(cwd, "zitadel.json"), "{ not valid json");

    await expect(readZitadelConfig(cwd)).rejects.toThrow();
    await expect(readZitadelConfig(cwd)).rejects.not.toBeInstanceOf(ZitadelError);
  });

  it("rejects a non-object JSON root via parseJsonObject", async ({ dir: cwd }) => {
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify([1, 2, 3]));

    await expect(readZitadelConfig(cwd)).rejects.toThrow("must contain a JSON object");
  });
});

describe("readZitadelSecret", () => {
  it("round-trips a real .zitadel/secret file", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(VALID_SECRET));

    await expect(readZitadelSecret(cwd)).resolves.toEqual(VALID_SECRET);
  });

  it("throws an actionable E_VALIDATION error when the file is missing", async ({ dir: cwd }) => {
    try {
      await readZitadelSecret(cwd);
      expect.unreachable("expected readZitadelSecret to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ZitadelError);
      const zerr = error as ZitadelError;
      expect(zerr.code).toBe("E_VALIDATION");
      expect(zerr.message).toContain(".zitadel/secret was not found");
      expect(zerr.hint).toContain("zitadel doctor --fix");
      expect(zerr.nextCommands).toEqual([{ id: "setup" }, { id: "doctor", flags: { fix: true } }]);
    }
  });

  it("throws when a required string field is missing", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    const { project_secret: _omit, ...partial } = VALID_SECRET;
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(partial));

    await expect(readZitadelSecret(cwd)).rejects.toThrow(
      ".zitadel/secret is missing required fields",
    );
  });

  it("throws when preview_origins is not an array", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({ ...VALID_SECRET, preview_origins: "nope" }),
    );

    await expect(readZitadelSecret(cwd)).rejects.toThrow(
      ".zitadel/secret is missing required fields",
    );
  });

  it("defaults missing primary_origins to an empty array", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    const { primary_origins: _omit, ...legacy } = VALID_SECRET;
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(legacy));

    await expect(readZitadelSecret(cwd)).resolves.toEqual({
      ...VALID_SECRET,
      primary_origins: [],
    });
  });

  it("propagates malformed-JSON errors unchanged (not wrapped as not-found)", async ({
    dir: cwd,
  }) => {
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

  it("round-trips through readZitadelSecret", async ({ dir: cwd }) => {
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

  it("preserves keys it does not know about", async ({ dir: cwd }) => {
    await seed(cwd, { future_field: { nested: true } });

    const secret = await readZitadelSecret(cwd);
    await writeZitadelSecret(cwd, { ...secret, team_id: "team-42" });

    const written = await readZitadelSecret(cwd);
    expect(written).toMatchObject({ future_field: { nested: true }, team_id: "team-42" });
  });

  it("writes at 0600 and leaves no temp file behind", async ({ dir: cwd }) => {
    await seed(cwd);

    await writeZitadelSecret(cwd, await readZitadelSecret(cwd));

    const mode = (await stat(join(cwd, ".zitadel/secret"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readdir(join(cwd, ".zitadel"))).toEqual(["secret"]);
  });

  it("writes deterministic, newline-terminated JSON", async ({ dir: cwd }) => {
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
