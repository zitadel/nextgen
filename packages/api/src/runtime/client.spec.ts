import { describe, expect, expectTypeOf, it } from "vitest";

import { ZitadelClient } from "./client";

const settings = { baseUrl: "https://example.com", allowDestructive: false } as const;

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

    const changed = client.with({ allowDestructive: true, timeoutMs: 20 });

    expect(changed).not.toBe(client);
    expect([changed.allowDestructive, changed.timeoutMs, changed.token]).toEqual([true, 20, "tok"]);
    expect([client.allowDestructive, client.timeoutMs]).toEqual([false, 10]);
  });

  it("clears a setting changed to undefined", () => {
    const client = new ZitadelClient({ ...settings, token: "tok" });

    expect(client.with({ token: undefined }).token).toBeUndefined();
  });

  it("is only what its constructor made, never an object of the same shape", () => {
    const lookalike = {
      baseUrl: "https://example.com",
      allowDestructive: true,
      token: undefined,
      signal: undefined,
      timeoutMs: undefined,
      userAgent: undefined,
      fetch: undefined,
      with: () => new ZitadelClient(settings),
    };

    expectTypeOf(lookalike).not.toExtend<ZitadelClient>();
  });

  it("makes every caller say whether destructive operations are allowed", () => {
    // @ts-expect-error -- allowDestructive has no default.
    expect(() => new ZitadelClient({ baseUrl: "https://example.com" })).not.toThrow();
  });
});
