import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ZitadelRefresher } from "@/lib/zitadel-upgrade";

async function refresherIn(signal: AbortSignal) {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-refresher-"));
  return { cwd, refresher: new ZitadelRefresher({ cwd, env: {}, noTelemetry: true, signal }) };
}

describe("ZitadelRefresher.appliesTo", () => {
  it("does not apply to a directory without a Zitadel config", async () => {
    const { cwd, refresher } = await refresherIn(new AbortController().signal);

    const applies = await refresher.appliesTo();

    await rm(cwd, { recursive: true, force: true });
    expect(applies).toBe(false);
  });
});

describe("ZitadelRefresher.refresh", () => {
  it("fails, rather than throws, when the new release cannot be run", async () => {
    const { cwd, refresher } = await refresherIn(new AbortController().signal);

    const outcome = await refresher.refresh("2.0.0");

    await rm(cwd, { recursive: true, force: true });
    expect(outcome).toBe("failed");
  });
});
