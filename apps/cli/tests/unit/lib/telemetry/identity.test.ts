import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, vi } from "vitest";

import { loadOrCreateIdentity, telemetryConfigDir } from "@/lib/telemetry/identity";
import { it } from "@tests/helpers/fixtures";

const { homedir } = vi.hoisted(() => {
  return { homedir: vi.fn<() => string>() };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir };
});

describe("telemetryConfigDir", () => {
  it("nests under XDG_CONFIG_HOME when set", () => {
    expect(telemetryConfigDir({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/zitadel/cli");
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
    homedir.mockReturnValue("/home/dev");

    expect(telemetryConfigDir({})).toBe("/home/dev/.config/zitadel/cli");
  });

  it("is undefined when the home directory cannot be determined", () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    expect(telemetryConfigDir({})).toBeUndefined();
  });
});

describe("loadOrCreateIdentity", () => {
  it("mints and persists an id on first run, then reuses it", ({ dir }) => {
    const env = { XDG_CONFIG_HOME: dir };

    const first = loadOrCreateIdentity(env);
    expect(first.isFirstRun).toBe(true);
    expect(first.distinctId).toMatch(/[0-9a-f-]{36}/);

    const second = loadOrCreateIdentity(env);
    expect(second.isFirstRun).toBe(false);
    expect(second.distinctId).toBe(first.distinctId);

    const stored = JSON.parse(
      readFileSync(join(env.XDG_CONFIG_HOME, "zitadel", "cli", "telemetry.json"), "utf8"),
    );
    expect(stored.distinctId).toBe(first.distinctId);
  });

  it("recovers from a corrupt store by minting a fresh id", ({ dir }) => {
    const env = { XDG_CONFIG_HOME: dir };
    loadOrCreateIdentity(env);
    const file = join(env.XDG_CONFIG_HOME, "zitadel", "cli", "telemetry.json");
    writeFileSync(file, "{not json");

    const recovered = loadOrCreateIdentity(env);
    expect(recovered.distinctId).toMatch(/[0-9a-f-]{36}/);
  });

  it("fails open to an ephemeral id when the home directory cannot be determined", () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    const identity = loadOrCreateIdentity({});

    expect(identity.isFirstRun).toBe(false);
    expect(identity.distinctId).toMatch(/[0-9a-f-]{36}/);
  });

  it("fails open to an ephemeral id when the config dir is unwritable", ({ dir }) => {
    // Point XDG at a path whose parent is a file, so mkdir throws ENOTDIR.
    const fileAsParent = join(dir, "afile");
    writeFileSync(fileAsParent, "x");

    const identity = loadOrCreateIdentity({ XDG_CONFIG_HOME: fileAsParent });
    expect(identity.isFirstRun).toBe(false);
    expect(identity.distinctId).toMatch(/[0-9a-f-]{36}/);
  });
});
