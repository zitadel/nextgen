import { describe, expect, expectTypeOf, it } from "vitest";

import { ZitadelClient } from "./client";

const settings = { baseUrl: "https://example.com" } as const;

describe("ZitadelClient", () => {
  it("drops trailing slashes from its base URL", () => {
    expect(new ZitadelClient({ ...settings, baseUrl: "https://example.com//" }).baseUrl).toBe(
      "https://example.com",
    );
  });

  it("cannot be changed once made", () => {
    const client = new ZitadelClient({ ...settings, token: "tok" });

    expect(Object.isFrozen(client)).toBe(true);
    expect(() => {
      (client as { token: string | undefined }).token = "other";
    }).toThrow(TypeError);
    expect(client.token).toBe("tok");
  });

  it("makes a new client for a change and leaves itself as it was", () => {
    const client = new ZitadelClient({ ...settings, token: "tok", timeoutMs: 10 });

    const changed = client.with({ userAgent: "agent/2", timeoutMs: 20 });

    expect(changed).not.toBe(client);
    expect([changed.userAgent, changed.timeoutMs, changed.token]).toEqual(["agent/2", 20, "tok"]);
    expect([client.userAgent, client.timeoutMs]).toEqual([undefined, 10]);
  });

  it("keeps the base URL when a change names it undefined", () => {
    const client = new ZitadelClient(settings);

    const changed = client.with({ baseUrl: undefined });

    expect(changed.baseUrl).toBe("https://example.com");
  });

  it("clears a setting changed to undefined", () => {
    const client = new ZitadelClient({ ...settings, token: "tok" });

    expect(client.with({ token: undefined }).token).toBeUndefined();
  });

  it("is only what its constructor made, never an object of the same shape", () => {
    const lookalike = {
      baseUrl: "https://example.com",
      token: undefined,
      signal: undefined,
      timeoutMs: undefined,
      userAgent: undefined,
      fetch: undefined,
      onRequest: undefined,
      with: () => new ZitadelClient(settings),
    };

    expectTypeOf(lookalike).not.toExtend<ZitadelClient>();
  });
});
