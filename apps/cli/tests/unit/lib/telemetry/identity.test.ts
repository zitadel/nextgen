import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadOrCreateIdentity,
  telemetryConfigDir,
} from "../../../../src/lib/telemetry/identity";

const dirs: string[] = [];

function freshConfigHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "ztel-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  // Temp dirs live under the OS tmp dir and are cheap to leave; nothing to undo.
  dirs.length = 0;
});

describe("telemetryConfigDir", () => {
  it("nests under XDG_CONFIG_HOME when set", () => {
    expect(telemetryConfigDir({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/zitadel/cli");
  });
});

describe("loadOrCreateIdentity", () => {
  it("mints and persists an id on first run, then reuses it", () => {
    const env = { XDG_CONFIG_HOME: freshConfigHome() };

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

  it("recovers from a corrupt store by minting a fresh id", () => {
    const env = { XDG_CONFIG_HOME: freshConfigHome() };
    loadOrCreateIdentity(env);
    const file = join(env.XDG_CONFIG_HOME, "zitadel", "cli", "telemetry.json");
    writeFileSync(file, "{not json");

    const recovered = loadOrCreateIdentity(env);
    expect(recovered.distinctId).toMatch(/[0-9a-f-]{36}/);
  });

  it("fails open to an ephemeral id when the config dir is unwritable", () => {
    // Point XDG at a path whose parent is a file, so mkdir throws ENOTDIR.
    const base = freshConfigHome();
    const fileAsParent = join(base, "afile");
    writeFileSync(fileAsParent, "x");

    const identity = loadOrCreateIdentity({ XDG_CONFIG_HOME: fileAsParent });
    expect(identity.isFirstRun).toBe(false);
    expect(identity.distinctId).toMatch(/[0-9a-f-]{36}/);
  });
});
