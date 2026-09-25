import { afterEach, describe, expect, it, vi } from "vitest";

import { setApiCsrfToken } from "./auth";
import { CSRF_HEADER, customFetch } from "./fetch";

function captureFetch() {
  const seen: Headers[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response(null, { status: 204 });
    }),
  );
  return seen;
}

afterEach(() => {
  setApiCsrfToken(undefined);
  vi.unstubAllGlobals();
});

describe("customFetch CSRF header", () => {
  it("sends the token on unsafe methods", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    for (const method of ["POST", "PATCH", "DELETE", "put"]) {
      await customFetch("http://api.test/x", { method });
    }
    expect(seen.map((headers) => headers.get(CSRF_HEADER))).toEqual(["tok", "tok", "tok", "tok"]);
  });

  it("leaves safe methods alone", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://api.test/x", {});
    await customFetch("http://api.test/x", { method: "GET" });
    expect(seen.map((headers) => headers.has(CSRF_HEADER))).toEqual([false, false]);
  });

  it("adds nothing when no token is set", async () => {
    const seen = captureFetch();
    await customFetch("http://api.test/x", { method: "POST" });
    expect(seen[0]?.has(CSRF_HEADER)).toBe(false);
  });

  it("keeps a header the caller set itself", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://api.test/x", { method: "POST", headers: { [CSRF_HEADER]: "own" } });
    expect(seen[0]?.get(CSRF_HEADER)).toBe("own");
  });
});
