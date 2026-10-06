import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import {
  detectEnvironment,
  envFilesFor,
  listLocalEnvironments,
  requireValue,
  resolveTarget,
} from "../../../src/lib/target";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-target-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (file: string, lines: Record<string, string>) =>
  writeFile(
    join(dir, file),
    `${Object.entries(lines)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
  );

describe("detectEnvironment", () => {
  it("takes --env over everything", () => {
    expect(detectEnvironment({ ZITADEL_ENV: "staging", VERCEL_ENV: "production" }, "prod")).toEqual(
      { value: "prod", source: "--env" },
    );
  });

  it("takes ZITADEL_ENV over a platform signal", () => {
    expect(detectEnvironment({ ZITADEL_ENV: "staging", VERCEL_ENV: "production" })).toEqual({
      value: "staging",
      source: "ZITADEL_ENV",
    });
  });

  it.each([
    [{ VERCEL_ENV: "preview" }, "preview", "VERCEL_ENV"],
    [{ CONTEXT: "deploy-preview" }, "preview", "CONTEXT"],
    [{ CONTEXT: "branch-deploy" }, "preview", "CONTEXT"],
    [{ CONTEXT: "production" }, "production", "CONTEXT"],
  ])("reads the platform signal %o", (env, value, source) => {
    expect(detectEnvironment(env)).toEqual({ value, source });
  });

  it("ignores NODE_ENV and defaults to development", () => {
    expect(detectEnvironment({ NODE_ENV: "production" })).toEqual({
      value: "development",
      source: "default",
    });
  });
});

describe("envFilesFor", () => {
  it("skips .env.local for test", () => {
    expect(envFilesFor("test")).toEqual([".env.test.local", ".env.test", ".env"]);
    expect(envFilesFor("production")).toEqual([
      ".env.production.local",
      ".env.local",
      ".env.production",
      ".env",
    ]);
  });
});

describe("resolveTarget", () => {
  it("lets the process environment beat every file", async () => {
    await write(".env.development.local", { ZITADEL_PROJECT_ID: "proj_file" });
    const target = await resolveTarget({ cwd: dir, env: { ZITADEL_PROJECT_ID: "proj_env" } });
    expect(target.values.ZITADEL_PROJECT_ID).toEqual({ value: "proj_env", source: "process env" });
  });

  it("reads the environment's files in order, each key from the first that has it", async () => {
    await write(".env.production.local", { ZITADEL_PROJECT_ID: "proj_prod_local" });
    await write(".env.local", { ZITADEL_PROJECT_ID: "proj_local", ZITADEL_URL: "https://local.example" });
    await write(".env", { ZITADEL_PROJECT_SECRET: "sk_base" });
    const target = await resolveTarget({ cwd: dir, env: {}, envName: "production" });
    expect(target.values.ZITADEL_PROJECT_ID).toEqual({
      value: "proj_prod_local",
      source: ".env.production.local",
    });
    expect(target.values.ZITADEL_URL).toEqual({ value: "https://local.example", source: ".env.local" });
    expect(target.values.ZITADEL_PROJECT_SECRET).toEqual({ value: "sk_base", source: ".env" });
    expect(target.consulted.map((entry) => entry.source)).toEqual([
      "--server flag",
      "process env",
      ".env.production.local",
      ".env.local",
      ".env.production",
      ".env",
      ".zitadel/secret",
    ]);
  });

  it("falls back to .zitadel/secret for the project and its credentials", async () => {
    await mkdir(join(dir, ".zitadel"));
    await writeFile(
      join(dir, ".zitadel/secret"),
      JSON.stringify({
        project_id: "proj_secret",
        project_secret: "sk_secret",
        preview_token: "sk_preview",
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
    const target = await resolveTarget({ cwd: dir, env: {} });
    expect(target.values.ZITADEL_PROJECT_ID).toEqual({ value: "proj_secret", source: ".zitadel/secret" });
    expect(target.values.ZITADEL_PREVIEW_TOKEN?.value).toBe("sk_preview");
  });

  it("reads only the named --env-file, which outranks the process environment", async () => {
    await mkdir(join(dir, "infra"));
    await write("infra/acme-staging.env", { ZITADEL_PROJECT_ID: "proj_staging" });
    await write(".env.local", { ZITADEL_PROJECT_SECRET: "sk_local" });
    const target = await resolveTarget({
      cwd: dir,
      env: { ZITADEL_PROJECT_ID: "proj_env", ZITADEL_URL: "https://env.example" },
      envFile: "infra/acme-staging.env",
    });
    expect(target.environment).toEqual({ value: "acme-staging", source: "--env-file" });
    expect(target.values.ZITADEL_PROJECT_ID?.value).toBe("proj_staging");
    expect(target.values.ZITADEL_URL?.value).toBe("https://env.example");
    expect(target.values.ZITADEL_PROJECT_SECRET).toBeUndefined();
  });

  it("refuses --env together with --env-file", async () => {
    await expect(
      resolveTarget({ cwd: dir, env: {}, envName: "prod", envFile: ".env.prod" }),
    ).rejects.toBeInstanceOf(ZitadelError);
  });

  it("names the environment, the key and every file consulted when a value is missing", async () => {
    const target = await resolveTarget({ cwd: dir, env: {}, envName: "production" });
    expect(() => requireValue(target, "ZITADEL_PROJECT_ID")).toThrow(
      /ZITADEL_PROJECT_ID is not set for environment production/,
    );
    try {
      requireValue(target, "ZITADEL_PROJECT_ID");
    } catch (error) {
      expect((error as ZitadelError).hint).toContain(".env.production.local");
      expect((error as ZitadelError).hint).toContain("(not present)");
    }
  });
});

describe("listLocalEnvironments", () => {
  it("lists every .env.<name>.local carrying a project id", async () => {
    await write(".env.production.local", { ZITADEL_PROJECT_ID: "proj_prod" });
    await write(".env.staging.local", { ZITADEL_URL: "https://x" });
    await write(".env.local", { ZITADEL_PROJECT_ID: "proj_dev" });
    expect((await listLocalEnvironments(dir)).map((entry) => entry.name)).toEqual(["production"]);
  });
});
