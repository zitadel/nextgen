import { afterEach, describe, expect, it, vi } from "vitest";

import { cloudGet, whenLive } from "./cloud-api";

afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body, { status })),
  );
}

describe("a screen's read", () => {
  it("is live when the functions answer it", async () => {
    answer(200, { tickets: [] });
    expect(await whenLive(cloudGet("/support/tickets"))).toEqual({
      live: true,
      data: { tickets: [] },
    });
  });

  it("is not live while the functions answer from no live system", async () => {
    answer(503, { error: { code: "cloud.not_live", message: "mocks only" } });
    expect(await whenLive(cloudGet("/billing"))).toEqual({ live: false });
  });

  it("still fails on any other refusal, so the console shows its error", async () => {
    answer(401, { error: { code: "auth.session_required", message: "Sign in first." } });
    await expect(whenLive(cloudGet("/billing"))).rejects.toMatchObject({
      code: "auth.session_required",
    });
  });
});
