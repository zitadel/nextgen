import { toZitadelError } from "@/lib/errors";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { Project, ProjectSecretMalformedError, ProjectSecretMissingError } from "@/lib/project";
import { it } from "@tests/fixtures";

const VALID_SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  primary_origins: [],
  preview_origins: ["https://example.test"],
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("Project.hasSecret", () => {
  it("is true only when .zitadel/secret exists", async ({ dir: cwd }) => {
    expect(await Project.at(cwd).hasSecret()).toBe(false);
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    expect(await Project.at(cwd).hasSecret()).toBe(false);
    await writeFile(join(cwd, ".zitadel", "secret"), "shh");
    expect(await Project.at(cwd).hasSecret()).toBe(true);
  });
});

describe("Project.secret", () => {
  it("round-trips a real .zitadel/secret file", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(VALID_SECRET));

    expect((await Project.at(cwd).secret()).data).toEqual(VALID_SECRET);
  });

  it("throws an actionable E_VALIDATION error when the file is missing", async ({ dir: cwd }) => {
    try {
      await Project.at(cwd).secret();
      expect.unreachable("expected ProjectSecret.read to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectSecretMissingError);
      const zerr = toZitadelError(error);
      expect(zerr.code).toBe("E_VALIDATION");
      expect(zerr.message).toContain(".zitadel/secret was not found");
      expect(zerr.hint).toContain("The project secret can be restored");
      expect(zerr.nextCommands).toBeUndefined();
    }
  });

  it("throws when a required string field is missing", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    const { project_secret: _omit, ...partial } = VALID_SECRET;
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(partial));

    await expect(Project.at(cwd).secret()).rejects.toThrow(
      ".zitadel/secret is missing required fields",
    );
  });

  it("throws when preview_origins is not an array", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({ ...VALID_SECRET, preview_origins: "nope" }),
    );

    await expect(Project.at(cwd).secret()).rejects.toThrow(
      ".zitadel/secret is missing required fields",
    );
  });

  it("defaults missing primary_origins to an empty array", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    const { primary_origins: _omit, ...legacy } = VALID_SECRET;
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(legacy));

    expect((await Project.at(cwd).secret()).data).toEqual({
      ...VALID_SECRET,
      primary_origins: [],
    });
  });

  it("reports malformed JSON as a malformed file, not a missing one", async ({ dir: cwd }) => {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), "{ broken");

    await expect(Project.at(cwd).secret()).rejects.toThrow();
    await expect(Project.at(cwd).secret()).rejects.toBeInstanceOf(ProjectSecretMalformedError);
  });
});

describe("Project.writeSecret", () => {
  async function seed(cwd: string, extra: Record<string, unknown> = {}): Promise<void> {
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ ...VALID_SECRET, ...extra }));
  }

  it("round-trips through ProjectSecret.read", async ({ dir: cwd }) => {
    await seed(cwd);

    const secret = await Project.at(cwd).secret();
    await secret.with({ claimed_at: "2026-02-02T00:00:00.000Z", team_id: "team-42" }).write();

    expect((await Project.at(cwd).secret()).data).toEqual({
      ...VALID_SECRET,
      claimed_at: "2026-02-02T00:00:00.000Z",
      team_id: "team-42",
    });
  });

  it("preserves keys it does not know about", async ({ dir: cwd }) => {
    await seed(cwd, { future_field: { nested: true } });

    const secret = await Project.at(cwd).secret();
    await secret.with({ team_id: "team-42" }).write();

    const written = await Project.at(cwd).secret();
    expect(written.data).toMatchObject({ future_field: { nested: true }, team_id: "team-42" });
  });

  it("writes at 0600 and leaves no temp file behind", async ({ dir: cwd }) => {
    await seed(cwd);

    await (await Project.at(cwd).secret()).write();

    const mode = (await stat(join(cwd, ".zitadel/secret"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readdir(join(cwd, ".zitadel"))).toEqual(["secret"]);
  });

  it("writes deterministic, newline-terminated JSON", async ({ dir: cwd }) => {
    await seed(cwd);
    const secret = await Project.at(cwd).secret();

    await secret.write();
    const first = await readFile(join(cwd, ".zitadel/secret"), "utf8");
    await secret.with({}).write();
    const second = await readFile(join(cwd, ".zitadel/secret"), "utf8");

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
  });
});

describe("ProjectSecret.write", () => {
  it("creates .zitadel when it is gone", async ({ dir: cwd }) => {
    await Project.at(cwd).writeSecret(VALID_SECRET);

    expect((await Project.at(cwd).secret()).data).toEqual(VALID_SECRET);
  });
});
