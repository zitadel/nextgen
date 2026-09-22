import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_ENV,
  hasDatabaseConfigured,
  isEnvSummary,
  loadEnvFiles,
  loadProjectEnv,
} from "../../../../src/lib/local-server/env-vars";

async function projectWith(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-test-"));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(cwd, name), contents, "utf8");
  }
  return cwd;
}

describe("dev-runtime env", () => {
  it("parses KEY=value lines, comments, quoted values, and a leading BOM", async () => {
    const cwd = await projectWith({
      ".env": "\uFEFF# comment\nA=1\nB=\"two words\"\nC='single'\n",
    });
    await expect(loadEnvFiles(cwd)).resolves.toEqual({ A: "1", B: "two words", C: "single" });
  });

  it("lets .env.local shadow .env and skips files that do not exist", async () => {
    const cwd = await projectWith({
      ".env.local": "SHARED=local\nONLY_LOCAL=yes\n",
      ".env": "SHARED=base\nONLY_BASE=yes\n",
    });

    await expect(loadEnvFiles(cwd)).resolves.toEqual({
      SHARED: "local",
      ONLY_LOCAL: "yes",
      ONLY_BASE: "yes",
    });
    await expect(loadEnvFiles(await projectWith({}))).resolves.toEqual({});
  });

  it("forwards only NEXTGEN_* names, sorted, and never the rest of the files", async () => {
    const cwd = await projectWith({
      ".env.local":
        "NEXTGEN_GOOGLE_SECRET=canary\nZITADEL_PROJECT_SECRET=app-side\nDATABASE_URL=postgres://nope\nnextgen_lower=no\n",
      ".env": "NEXTGEN_API_KEY=key\nNEXTGEN_GOOGLE_SECRET=loses\n",
    });

    await expect(loadProjectEnv(cwd)).resolves.toEqual({
      values: { NEXTGEN_API_KEY: "key", NEXTGEN_GOOGLE_SECRET: "canary" },
      injected: ["NEXTGEN_API_KEY", "NEXTGEN_GOOGLE_SECRET"],
    });
  });

  it("never reads the keys the CLI sets itself at spawn", async () => {
    const cwd = await projectWith({
      ".env.local":
        "NEXTGEN_SERVER_DATA_DIR=/elsewhere\nNEXTGEN_SERVER_ADDRESS=:1\nNEXTGEN_SERVER_PUBLIC_BASE=http://x\nNEXTGEN_OK=1\n",
    });
    await expect(loadProjectEnv(cwd)).resolves.toEqual({
      values: { NEXTGEN_OK: "1" },
      injected: ["NEXTGEN_OK"],
    });
  });

  it("treats an empty value as unset", async () => {
    const cwd = await projectWith({ ".env.local": "NEXTGEN_EMPTY=\nNEXTGEN_SET=x\n" });
    await expect(loadProjectEnv(cwd)).resolves.toEqual({
      values: { NEXTGEN_SET: "x" },
      injected: ["NEXTGEN_SET"],
    });
  });

  it("yields the empty result for a project with no env files", async () => {
    await expect(loadProjectEnv(await projectWith({}))).resolves.toEqual(EMPTY_ENV);
  });

  it("recognises a well-formed env block from runtime.json and rejects the rest", () => {
    expect(isEnvSummary({ injected: ["A"] })).toBe(true);
    expect(isEnvSummary({ injected: ["A", 1] })).toBe(false);
    expect(isEnvSummary({})).toBe(false);
    expect(isEnvSummary(null)).toBe(false);
  });
});

describe("local server database selection", () => {
  // The local server defaults to the filesystem configuration store so that
  // editing `.zitadel/**` shows up without a restart. That default has to
  // yield to a developer who named their own dialect: the server accepts
  // exactly one `database.*` key and refuses to start with two.
  it("reports no database when the project declares none", () => {
    expect(hasDatabaseConfigured({}, {})).toBe(false);
    expect(hasDatabaseConfigured({ NEXTGEN_SERVER_ADDRESS: ":8080" }, {})).toBe(false);
  });

  it("reports a database declared in the project env files", () => {
    expect(hasDatabaseConfigured({ NEXTGEN_DATABASE_POSTGRES: "postgres://…" }, {})).toBe(true);
  });

  it("reports a database exported into the ambient environment", () => {
    expect(hasDatabaseConfigured({}, { NEXTGEN_DATABASE_SQLITE: "/tmp/x.db" })).toBe(true);
  });

  // Any registered dialect counts, not a hardcoded list: the server binds one
  // env key per registered dialect, so a dialect added later must switch the
  // default off here without this code changing.
  it("reports any dialect name under the database prefix", () => {
    expect(hasDatabaseConfigured({ NEXTGEN_DATABASE_SPANNER: "projects/…" }, {})).toBe(true);
    expect(hasDatabaseConfigured({ NEXTGEN_DATABASE_SOMETHINGNEW: "x" }, {})).toBe(true);
  });

  it("ignores an unset variable", () => {
    expect(hasDatabaseConfigured({}, { NEXTGEN_DATABASE_POSTGRES: undefined })).toBe(false);
  });
});
