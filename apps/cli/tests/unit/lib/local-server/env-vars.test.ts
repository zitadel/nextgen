import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_ENV,
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
    const cwd = await projectWith({ ".env": "\uFEFF# comment\nA=1\nB=\"two words\"\nC='single'\n" });
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

  it("forwards only ZITADEL_* names, sorted, and never the rest of the files", async () => {
    const cwd = await projectWith({
      ".env.local": "ZITADEL_GOOGLE_SECRET=canary\nDATABASE_URL=postgres://nope\nzitadel_lower=no\n",
      ".env": "ZITADEL_API_KEY=key\nZITADEL_GOOGLE_SECRET=loses\n",
    });

    await expect(loadProjectEnv(cwd)).resolves.toEqual({
      values: { ZITADEL_API_KEY: "key", ZITADEL_GOOGLE_SECRET: "canary" },
      injected: ["ZITADEL_API_KEY", "ZITADEL_GOOGLE_SECRET"],
    });
  });

  it("treats an empty value as unset", async () => {
    const cwd = await projectWith({ ".env.local": "ZITADEL_EMPTY=\nZITADEL_SET=x\n" });
    await expect(loadProjectEnv(cwd)).resolves.toEqual({
      values: { ZITADEL_SET: "x" },
      injected: ["ZITADEL_SET"],
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
