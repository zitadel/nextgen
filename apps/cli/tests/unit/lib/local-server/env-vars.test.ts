import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_ENV,
  isEnvSummary,
  LOCAL_DEFAULTS,
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

/** A shell that turns every local default off, so a test sees only the files. */
const NO_DEFAULTS = Object.fromEntries(Object.keys(LOCAL_DEFAULTS).map((name) => [name, ""]));

const ALLOW_LIST = "NEXTGEN_HTTPCLIENT_ALLOW_LIST";

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

    await expect(loadProjectEnv(cwd, NO_DEFAULTS)).resolves.toEqual({
      values: { NEXTGEN_API_KEY: "key", NEXTGEN_GOOGLE_SECRET: "canary" },
      injected: ["NEXTGEN_API_KEY", "NEXTGEN_GOOGLE_SECRET"],
    });
  });

  it("never reads the keys the CLI sets itself at spawn", async () => {
    const cwd = await projectWith({
      ".env.local":
        "NEXTGEN_SERVER_DATA_DIR=/elsewhere\nNEXTGEN_SERVER_ADDRESS=:1\nNEXTGEN_SERVER_PUBLIC_BASE=http://x\nNEXTGEN_OK=1\n",
    });
    await expect(loadProjectEnv(cwd, NO_DEFAULTS)).resolves.toEqual({
      values: { NEXTGEN_OK: "1" },
      injected: ["NEXTGEN_OK"],
    });
  });

  it("treats an empty value as unset", async () => {
    const cwd = await projectWith({ ".env.local": "NEXTGEN_EMPTY=\nNEXTGEN_SET=x\n" });
    await expect(loadProjectEnv(cwd, NO_DEFAULTS)).resolves.toEqual({
      values: { NEXTGEN_SET: "x" },
      injected: ["NEXTGEN_SET"],
    });
  });

  it("yields the empty result for a project with no env files", async () => {
    await expect(loadProjectEnv(await projectWith({}), NO_DEFAULTS)).resolves.toEqual(EMPTY_ENV);
  });

  it("lets a local server fetch from loopback by default", async () => {
    await expect(loadProjectEnv(await projectWith({}), {})).resolves.toEqual({
      values: { [ALLOW_LIST]: "localhost,127.0.0.0/8,::1/128" },
      injected: [ALLOW_LIST],
    });
  });

  it("lets an env file replace a default", async () => {
    const cwd = await projectWith({ ".env.local": `${ALLOW_LIST}=127.0.0.1\n` });
    await expect(loadProjectEnv(cwd, {})).resolves.toEqual({
      values: { [ALLOW_LIST]: "127.0.0.1" },
      injected: [ALLOW_LIST],
    });
  });

  it("turns a default off when an env file sets it empty", async () => {
    const cwd = await projectWith({ ".env": `${ALLOW_LIST}=\n` });
    await expect(loadProjectEnv(cwd, {})).resolves.toEqual(EMPTY_ENV);
  });

  it("leaves a default to the shell when the shell sets it, empty included", async () => {
    const cwd = await projectWith({});
    await expect(loadProjectEnv(cwd, { [ALLOW_LIST]: "10.0.0.0/8" })).resolves.toEqual(EMPTY_ENV);
    await expect(loadProjectEnv(cwd, { [ALLOW_LIST]: "" })).resolves.toEqual(EMPTY_ENV);
  });

  it("recognises a well-formed env block from runtime.json and rejects the rest", () => {
    expect(isEnvSummary({ injected: ["A"] })).toBe(true);
    expect(isEnvSummary({ injected: ["A", 1] })).toBe(false);
    expect(isEnvSummary({})).toBe(false);
    expect(isEnvSummary(null)).toBe(false);
  });
});
