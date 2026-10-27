import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { load } from "./load";

describe("load", () => {
  const down = async () => {
    throw new Error("GitHub answered with 503 Service Unavailable");
  };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("answers the fallback while the site builds, so GitHub never fails a deploy", async () => {
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);

    await expect(load(down, "unread")).resolves.toBe("unread");
  });

  it("rethrows when a page regenerates, so the page served last stays up", async () => {
    vi.stubEnv("NEXT_PHASE", "");

    await expect(load(down, "unread")).rejects.toThrow("503");
  });
});
