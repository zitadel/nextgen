import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JWKS_FAILURE_BACKOFF_MS,
  JWKS_MIN_REFRESH_MS,
  JWKS_TTL_MS,
  verifyJwt,
  type VerifyJwtOptions,
} from "./jwt.js";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The JWKS is cached per issuer, so every test signs for an issuer of its own. */
let issuerCounter = 0;
function freshIssuer(): string {
  return `http://issuer-${++issuerCounter}.test`;
}

function sign(issuer: string, kid: string | undefined, alg: "RS256" | "ES256", key: KeyObject) {
  const header = b64url(Buffer.from(JSON.stringify({ alg, typ: "JWT", ...(kid ? { kid } : {}) })));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    Buffer.from(JSON.stringify({ iss: issuer, sub: "u1", exp: now + 60, iat: now })),
  );
  const signer = createSign("SHA256").update(`${header}.${body}`);
  const sig = alg === "ES256" ? signer.sign({ key, dsaEncoding: "ieee-p1363" }) : signer.sign(key);
  return `${header}.${body}.${b64url(sig)}`;
}

function jwk(key: KeyObject, extra: Record<string, unknown>): Record<string, unknown> {
  return { ...(key.export({ format: "jwk" }) as Record<string, unknown>), ...extra };
}

/** Serves `keys` as the JWKS of every issuer and counts the fetches. */
function serveJwks(keys: () => readonly Record<string, unknown>[]) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ keys: keys() }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function opts(issuer: string): VerifyJwtOptions {
  return {
    issuerUrl: issuer,
    clockSkewMs: 0,
    allowedTokenTypes: ["JWT"],
    allowedAlgorithms: ["RS256", "ES256"],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyJwt JWKS caching", () => {
  it("verifies a token against the issuer's JWKS", async () => {
    const issuer = freshIssuer();
    serveJwks(() => [jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })]);

    expect(
      await verifyJwt(sign(issuer, "k1", "RS256", rsa.privateKey), opts(issuer)),
    ).toMatchObject({
      sub: "u1",
    });
  });

  it("fetches the JWKS once for repeated tokens", async () => {
    const issuer = freshIssuer();
    const fetchMock = serveJwks(() => [jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })]);
    const token = sign(issuer, "k1", "RS256", rsa.privateKey);

    await verifyJwt(token, opts(issuer));
    await verifyJwt(token, opts(issuer));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The kid header is attacker-controlled: a made-up kid must not cost a fetch.
  it("answers tokens naming unknown kids from the cache", async () => {
    const issuer = freshIssuer();
    const fetchMock = serveJwks(() => [jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })]);
    await verifyJwt(sign(issuer, "k1", "RS256", rsa.privateKey), opts(issuer));

    for (let i = 0; i < 20; i++) {
      await verifyJwt(sign(issuer, `random-${i}`, "RS256", rsa.privateKey), opts(issuer));
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one fetch between concurrent first requests", async () => {
    const issuer = freshIssuer();
    const fetchMock = serveJwks(() => [jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })]);
    const token = sign(issuer, "k1", "RS256", rsa.privateKey);

    await Promise.all(Array.from({ length: 5 }, () => verifyJwt(token, opts(issuer))));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("picks up a rotated key once the minimum refresh interval has passed", async () => {
    const issuer = freshIssuer();
    let keys = [jwk(rsa.publicKey, { kid: "old", alg: "RS256" })];
    serveJwks(() => keys);
    const start = Date.now();
    await verifyJwt(sign(issuer, "old", "RS256", rsa.privateKey), opts(issuer));
    keys = [jwk(rsa.publicKey, { kid: "new", alg: "RS256" })];
    vi.spyOn(Date, "now").mockReturnValue(start + JWKS_MIN_REFRESH_MS + 1_000);

    expect(
      await verifyJwt(sign(issuer, "new", "RS256", rsa.privateKey), opts(issuer)),
    ).not.toBeNull();
  });

  it("refetches the JWKS once the cache has expired", async () => {
    const issuer = freshIssuer();
    const fetchMock = serveJwks(() => [jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })]);
    const token = sign(issuer, "k1", "RS256", rsa.privateKey);
    const start = Date.now();
    await verifyJwt(token, opts(issuer));
    vi.spyOn(Date, "now").mockReturnValue(start + JWKS_TTL_MS + 1_000);

    await verifyJwt(token, opts(issuer));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // An expired cache whose refresh fails keeps verifying against the keys it
  // holds: a JWKS outage must not reject every bearer until the endpoint is back.
  it.each([
    ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["an unreadable body", () => Promise.resolve(new Response("<html>", { status: 200 }))],
  ])("keeps the cached keys when a refresh after the TTL fails with %s", async (_label, fail) => {
    const issuer = freshIssuer();
    const fetchMock = serveJwks(() => [jwk(ec.publicKey, { kid: "k1", alg: "ES256" })]);
    const start = Date.now();
    await verifyJwt(sign(issuer, "k1", "ES256", ec.privateKey), opts(issuer));
    vi.spyOn(Date, "now").mockReturnValue(start + JWKS_TTL_MS + 1_000);
    fetchMock.mockImplementation(fail);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await verifyJwt(sign(issuer, "k1", "ES256", ec.privateKey), opts(issuer))).toMatchObject(
      { sub: "u1" },
    );
  });

  it("rejects the token and logs when the first JWKS fetch fails and nothing is cached", async () => {
    const issuer = freshIssuer();
    const failure = new TypeError("fetch failed");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(failure)),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await verifyJwt(sign(issuer, "k1", "RS256", rsa.privateKey), opts(issuer))).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`could not refresh the JWKS at ${issuer}/auth/keys`),
    );
  });
});

describe("verifyJwt JWKS refresh backoff", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A JWKS endpoint that fails every fetch with `failure`, counting them. */
  function failingJwks(failure: () => Promise<Response>) {
    const fetchMock = vi.fn(failure);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it.each([
    ["a 503", () => Promise.resolve(new Response(null, { status: 503 }))],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
  ])("logs a failed refresh with %s once per backoff window", async (_label, failure) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuer = freshIssuer();
    failingJwks(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = sign(issuer, "k1", "RS256", rsa.privateKey);

    for (let i = 0; i < 5; i++) {
      await verifyJwt(token, opts(issuer));
    }

    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("does not fetch the JWKS again within the backoff after a failed refresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuer = freshIssuer();
    const fetchMock = failingJwks(() => Promise.reject(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = sign(issuer, "k1", "RS256", rsa.privateKey);
    await verifyJwt(token, opts(issuer));

    vi.advanceTimersByTime(JWKS_FAILURE_BACKOFF_MS - 1);
    await verifyJwt(token, opts(issuer));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches the JWKS again once the backoff has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuer = freshIssuer();
    const fetchMock = failingJwks(() => Promise.reject(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = sign(issuer, "k1", "RS256", rsa.privateKey);
    await verifyJwt(token, opts(issuer));
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ keys: [jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })] })),
    );

    vi.advanceTimersByTime(JWKS_FAILURE_BACKOFF_MS);

    expect(await verifyJwt(token, opts(issuer))).toMatchObject({ sub: "u1" });
  });

  it("keeps verifying against the cached keys without refetching during the backoff", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const issuer = freshIssuer();
    const fetchMock = serveJwks(() => [jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })]);
    await verifyJwt(sign(issuer, "k1", "RS256", rsa.privateKey), opts(issuer));
    vi.advanceTimersByTime(JWKS_TTL_MS);
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (let i = 0; i < 3; i++) {
      expect(
        await verifyJwt(sign(issuer, "k1", "RS256", rsa.privateKey), opts(issuer)),
      ).toMatchObject({ sub: "u1" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("verifyJwt key selection", () => {
  // RFC 7517 makes a JWK's alg optional; the curve decides an EC key's algorithm.
  it("verifies an ES256 token against an EC key that names no alg", async () => {
    const issuer = freshIssuer();
    serveJwks(() => [jwk(ec.publicKey, { kid: "ec1" })]);

    expect(
      await verifyJwt(sign(issuer, "ec1", "ES256", ec.privateKey), opts(issuer)),
    ).not.toBeNull();
  });

  it("rejects a token whose alg does not fit the key, without logging an error", async () => {
    const issuer = freshIssuer();
    serveJwks(() => [jwk(ec.publicKey, { kid: "ec1" })]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await verifyJwt(sign(issuer, "ec1", "RS256", rsa.privateKey), opts(issuer))).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("rejects a token whose alg differs from the alg the key names", async () => {
    const issuer = freshIssuer();
    serveJwks(() => [jwk(ec.publicKey, { kid: "ec1", alg: "ES384" })]);

    expect(await verifyJwt(sign(issuer, "ec1", "ES256", ec.privateKey), opts(issuer))).toBeNull();
  });

  it("uses the first key for a token that names no kid", async () => {
    const issuer = freshIssuer();
    serveJwks(() => [jwk(rsa.publicKey, { alg: "RS256" })]);

    expect(
      await verifyJwt(sign(issuer, undefined, "RS256", rsa.privateKey), opts(issuer)),
    ).not.toBeNull();
  });
});
