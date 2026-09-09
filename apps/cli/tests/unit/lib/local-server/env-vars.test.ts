import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_ENV,
  envWarnings,
  isEnvSummary,
  loadEnvFiles,
  loadProjectEnv,
  resolveEnvNames,
} from "../../../../src/lib/local-server/env-vars";

async function projectWith(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-env-test-"));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(cwd, name), contents, "utf8");
  }
  return cwd;
}

describe("dev-runtime env resolution", () => {
  it("parses KEY=value lines, comments, and quoted values", async () => {
    const cwd = await projectWith({ ".env": "# comment\nA=1\nB=\"two words\"\nC='single'\n" });
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

  it("resolves declared names in source order and reports the rest as missing", () => {
    const resolved = resolveEnvNames(
      ["FROM_FILE", "FROM_SHELL", "ABSENT", "FROM_FILE"],
      [{ FROM_FILE: "f" }, { FROM_FILE: "shadowed", FROM_SHELL: "s" }],
    );

    expect(resolved.values).toEqual({ FROM_FILE: "f", FROM_SHELL: "s" });
    expect(resolved.injected).toEqual(["FROM_FILE", "FROM_SHELL"]);
    expect(resolved.missing).toEqual(["ABSENT"]);
  });

  it("treats an empty value as unset, like plan does", () => {
    const resolved = resolveEnvNames(
      ["EMPTY", "SHADOWED"],
      [{ EMPTY: "", SHADOWED: "" }, { SHADOWED: "s" }],
    );
    expect(resolved.values).toEqual({ SHADOWED: "s" });
    expect(resolved.missing).toEqual(["EMPTY"]);
  });

  it("ignores prototype-chain names and never injects them", () => {
    const resolved = resolveEnvNames(
      ["constructor", "__proto__", "toString", "REAL"],
      [{ REAL: "r" }],
    );
    expect(resolved.values).toEqual({ REAL: "r" });
    expect(resolved.injected).toEqual(["REAL"]);
    expect(resolved.missing).toEqual(["constructor", "__proto__", "toString"]);
  });

  it("drops reserved names instead of letting a project file set them", () => {
    const resolved = resolveEnvNames(
      [
        "PATH",
        "NODE_OPTIONS",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "NEXTGEN_SERVER_DATA_DIR",
        "OK",
      ],
      [{ PATH: "/evil", NODE_OPTIONS: "--require evil.js", OK: "fine" }],
    );
    expect(resolved).toEqual({ values: { OK: "fine" }, injected: ["OK"], missing: [] });
  });

  it("recognises a well-formed env block from runtime.json and rejects the rest", () => {
    expect(isEnvSummary({ injected: ["A"], missing: [] })).toBe(true);
    expect(isEnvSummary({ injected: [] })).toBe(false);
    expect(isEnvSummary({ injected: ["A", 1], missing: [] })).toBe(false);
    expect(isEnvSummary(null)).toBe(false);
  });

  it("only forwards declared names, never the rest of the env files", async () => {
    const cwd = await projectWith({
      ".env.local": "GOOGLE_CLIENT_SECRET=canary-secret\nDATABASE_URL=postgres://nope\n",
    });

    const resolved = await loadProjectEnv(cwd, ["GOOGLE_CLIENT_SECRET"], {});

    expect(resolved.values).toEqual({ GOOGLE_CLIENT_SECRET: "canary-secret" });
    expect(Object.keys(resolved.values)).not.toContain("DATABASE_URL");
    expect(resolved.injected).toEqual(["GOOGLE_CLIENT_SECRET"]);
    expect(resolved.missing).toEqual([]);
  });

  it("returns the empty result without touching disk when nothing is declared", async () => {
    const resolved = await loadProjectEnv("/definitely/not/a/dir", []);
    expect(resolved).toBe(EMPTY_ENV);
  });

  it("phrases the missing-variable warning with names only", () => {
    expect(envWarnings(EMPTY_ENV)).toEqual([]);
    expect(envWarnings({ injected: [], missing: ["GOOGLE_CLIENT_SECRET"] })).toEqual([
      expect.stringMatching(
        /^Variable GOOGLE_CLIENT_SECRET is referenced .* \.env\.local, \.env .* run `zitadel stop` and `zitadel start`\.$/,
      ),
    ]);
    expect(envWarnings({ injected: [], missing: ["A", "B"] })).toEqual([
      expect.stringMatching(/^Variables A, B are referenced/),
    ]);
  });
});
