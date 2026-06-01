import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SERVER, resolveServer } from "../../../src/lib/server";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-resolve-server-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await writeFile(join(dir, "zitadel.json"), JSON.stringify(config), "utf8");
}

describe("resolveServer", () => {
  it("falls back to DEFAULT_SERVER when nothing resolves and no config exists", async () => {
    const resolved = await resolveServer({ cwd: dir, env: {} });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("prefers the --server flag above all other sources", async () => {
    await writeConfig({ server: "https://config.example.com" });
    const resolved = await resolveServer({
      cwd: dir,
      env: { ZITADEL_API_BASE: "https://env.example.com" },
      serverFlag: "https://flag.example.com",
      environment: "production",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("uses ZITADEL_API_BASE env when no flag is given", async () => {
    await writeConfig({ server: "https://config.example.com" });
    const resolved = await resolveServer({
      cwd: dir,
      env: { ZITADEL_API_BASE: "https://env.example.com" },
    });
    expect(resolved).toEqual({ value: "https://env.example.com", origin: "env" });
  });

  it("reads the selected environment block from zitadel.json", async () => {
    await writeConfig({
      server: "https://top.example.com",
      environments: {
        production: { server: "https://prod.example.com" },
      },
    });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://prod.example.com", origin: "config-env" });
  });

  it("falls through to the top-level server when the env block is absent", async () => {
    await writeConfig({
      server: "https://top.example.com",
      environments: { preview: { server: "https://preview.example.com" } },
    });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("uses the top-level server when no environment is provided", async () => {
    await writeConfig({ server: "https://top.example.com" });
    const resolved = await resolveServer({ cwd: dir, env: {} });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("falls back to DEFAULT_SERVER when the config has no server fields", async () => {
    await writeConfig({ environments: { production: { other: "value" } } });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: DEFAULT_SERVER, origin: "default" });
  });

  it("ignores a non-string environment server and falls through to top-level", async () => {
    await writeConfig({
      server: "https://top.example.com",
      environments: { production: { server: 123 } },
    });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("ignores an array-valued environments field", async () => {
    await writeConfig({ server: "https://top.example.com", environments: ["nope"] });
    const resolved = await resolveServer({ cwd: dir, env: {}, environment: "production" });
    expect(resolved).toEqual({ value: "https://top.example.com", origin: "config-top" });
  });

  it("normalises a resolved URL down to its origin", async () => {
    const resolved = await resolveServer({
      cwd: dir,
      env: {},
      serverFlag: "https://flag.example.com/some/path?q=1",
    });
    expect(resolved).toEqual({ value: "https://flag.example.com", origin: "flag" });
  });

  it("rejects a non-http(s) URL with E_VALIDATION", async () => {
    await expect(
      resolveServer({ cwd: dir, env: {}, serverFlag: "ftp://flag.example.com" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("rejects an unparseable URL with E_VALIDATION", async () => {
    await expect(
      resolveServer({ cwd: dir, env: {}, serverFlag: "not a url" }),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
