import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZitadelRefresher } from "@/lib/zitadel-upgrade/zitadel-refresher";

let cwd: string;

function refresher(signal: AbortSignal): ZitadelRefresher {
  return new ZitadelRefresher({ cwd, env: {}, noTelemetry: true, signal });
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-refresher-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("ZitadelRefresher.appliesTo", () => {
  it("does not apply to a directory without a Zitadel config", async () => {
    await expect(refresher(new AbortController().signal).appliesTo()).resolves.toBe(false);
  });
});

describe("ZitadelRefresher.refresh", () => {
  it("fails, rather than throws, when the new release cannot be run", async () => {
    await expect(refresher(new AbortController().signal).refresh("2.0.0")).resolves.toBe("failed");
  });
});
