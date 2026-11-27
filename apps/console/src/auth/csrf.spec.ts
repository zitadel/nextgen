import { afterEach, describe, expect, it } from "vitest";

import { csrfProvider, getCsrfToken, setCsrfRefresh, setCsrfToken } from "./csrf";

afterEach(() => {
  setCsrfToken(undefined);
});

describe("csrfProvider", () => {
  it("sends the token only to the origin it names", () => {
    expect(csrfProvider("http://api.test").origin).toBe("http://api.test");
  });

  it("reads the token stored now, not the one stored when it was made", () => {
    const provider = csrfProvider("http://api.test");

    setCsrfToken("first");
    const first = provider.token();
    setCsrfToken("second");

    expect([first, provider.token(), getCsrfToken()]).toEqual(["first", "second", "second"]);
  });

  it("asks the registered re-check for a fresh token", async () => {
    setCsrfRefresh(async () => "fresh");

    await expect(csrfProvider("http://api.test").refresh()).resolves.toBe("fresh");
  });
});
