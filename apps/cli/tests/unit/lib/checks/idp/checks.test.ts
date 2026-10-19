import { describe, expect, it } from "vitest";

import { runChecks } from "../../../../../src/lib/checks/check";
import { IDP_CHECKS } from "../../../../../src/lib/checks/idp";
import {
  idpContext,
  type Discovery,
  type HttpResponse,
  type IdpContext,
  type ProviderProbes,
} from "../../../../../src/lib/checks/idp/context";

const DOCUMENT: Discovery = {
  issuer: "https://issuer.example",
  authorization_endpoint: "https://issuer.example/authorize",
  token_endpoint: "https://issuer.example/token",
  jwks_uri: "https://issuer.example/jwks",
  userinfo_endpoint: "https://issuer.example/userinfo",
  scopes_supported: ["openid", "email"],
  claims_supported: ["sub", "email"],
  code_challenge_methods_supported: ["S256"],
};

const ACCEPTING: ProviderProbes = { authorize: () => ({ kind: "accepted" }) };

/** A provider that serves `document`, records every URL it was asked for, and answers probes with `{ status: 200 }`. */
function aContext(
  overrides: Partial<Omit<IdpContext, "discovery">> = {},
  document: Discovery | null = DOCUMENT,
) {
  const asked: string[] = [];
  const context = idpContext({
    slug: "acme",
    issuer: "https://issuer.example",
    clientId: "the-client",
    scopes: ["openid", "email"],
    claims: ["email"],
    callbackUri: "http://localhost:3000/__nextgen/idp/acme/callback",
    endpoints: undefined,
    consoleUrl: "https://console.example",
    probes: ACCEPTING,
    request: async (url): Promise<HttpResponse> => {
      asked.push(url);
      return url.endsWith("/.well-known/openid-configuration")
        ? { status: document === null ? 404 : 200, url, body: JSON.stringify(document ?? {}) }
        : { status: 200, url, body: "" };
    },
    ...overrides,
  });
  return { context, asked };
}

async function resultsFor(
  overrides?: Partial<Omit<IdpContext, "discovery">>,
  document?: Discovery | null,
) {
  const { context, asked } = aContext(overrides, document);
  const results = await runChecks(IDP_CHECKS, context);
  return { asked, by: (name: string) => results.find((result) => result.name === name) };
}

describe("IDP_CHECKS", () => {
  it("passes every check for a provider that accepts the connection", async () => {
    const { by } = await resultsFor();

    expect(IDP_CHECKS.map((check) => by(check.name)?.status)).toEqual(
      Array(IDP_CHECKS.length).fill("pass"),
    );
  });

  it("fails discovery, and skips what needs it, for a provider that cannot be read", async () => {
    const { by } = await resultsFor({}, null);

    expect([by("discovery")?.status, by("issuer")?.status, by("callback-uri")?.status]).toEqual([
      "fail",
      "skipped",
      "skipped",
    ]);
  });

  it.each([
    ["token_endpoint", { ...DOCUMENT, token_endpoint: undefined }],
    ["authorization_endpoint", { ...DOCUMENT, authorization_endpoint: undefined }],
    ["jwks_uri", { ...DOCUMENT, jwks_uri: undefined }],
    ["jwks_uri", { ...DOCUMENT, jwks_uri: "http://issuer.example/jwks" }],
    ["token_endpoint", { ...DOCUMENT, token_endpoint: "http://issuer.example/token" }],
  ])(
    "fails a discovery document with no usable %s, as the runtime would",
    async (name, document) => {
      const { by } = await resultsFor({}, document);

      expect(by("discovery")).toMatchObject({
        status: "fail",
        message: expect.stringContaining(name),
        recovery: expect.stringContaining(name),
      });
    },
  );

  it("still needs the keys of a connection that reads claims from the ID token", async () => {
    const { by } = await resultsFor({ idTokenMapping: true }, { ...DOCUMENT, jwks_uri: undefined });

    expect(by("discovery")?.status).toBe("fail");
  });

  it("fails a connection that names some of its endpoints but not the rest, as the server would", async () => {
    const { by } = await resultsFor({
      endpoints: { authorization: "https://issuer.example/authorize" },
      missingEndpoints: ["jwks_uri", "token_endpoint", "userinfo_endpoint"],
    });

    expect(by("discovery")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("token_endpoint"),
    });
  });

  it("fails a connection whose own endpoint is not https, as the server would", async () => {
    const { by } = await resultsFor({
      endpoints: { authorization: "https://issuer.example/authorize" },
      configuredEndpoints: {
        authorization_endpoint: "https://issuer.example/authorize",
        token_endpoint: "http://idp.example/token",
      },
    });

    expect(by("discovery")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("token_endpoint"),
      recovery: expect.stringContaining("oidc.token_endpoint"),
    });
  });

  it("does not need a userinfo endpoint from a connection that reads claims from the ID token", async () => {
    const { by } = await resultsFor(
      { idTokenMapping: true },
      { ...DOCUMENT, userinfo_endpoint: undefined },
    );

    expect(by("discovery")?.status).toBe("pass");
  });

  it("fails the probe, with a way to retry, when the authorization endpoint cannot be reached", async () => {
    const { context } = aContext({
      request: async (url) => {
        if (url.endsWith("/.well-known/openid-configuration")) {
          return { status: 200, url, body: JSON.stringify(DOCUMENT) };
        }
        throw new Error("The operation timed out");
      },
    });

    const results = await runChecks(IDP_CHECKS, context);

    expect(results.find((result) => result.name === "callback-uri")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("timed out"),
      recovery: expect.stringContaining("https://issuer.example"),
    });
  });

  it("tells a connection whose provider lists no userinfo endpoint to read claims from the ID token", async () => {
    const { by } = await resultsFor({}, { ...DOCUMENT, userinfo_endpoint: undefined });

    expect(by("discovery")?.recovery).toContain("id_token_mapping");
  });

  it("explains a templated issuer instead of telling the developer to copy it", async () => {
    const { by } = await resultsFor(
      {},
      { ...DOCUMENT, issuer: "https://login.example/{tenantid}/v2.0" },
    );

    expect(by("issuer")?.recovery).toContain("templated issuer");
  });

  it("words a single scope or claim in the singular", async () => {
    const { by } = await resultsFor({ scopes: ["openid"], claims: ["email"] });

    expect([by("scopes")?.message, by("claims")?.message]).toEqual([
      "openid is listed by the provider",
      "email is listed by the provider",
    ]);
  });

  it("fails an issuer the provider does not report, naming the one it does", async () => {
    const { by } = await resultsFor({}, { ...DOCUMENT, issuer: "https://other.example" });

    expect(by("issuer")).toMatchObject({
      status: "fail",
      recovery: expect.stringContaining("https://other.example"),
    });
  });

  it("fails an issuer that differs only by a trailing slash, as the server would", async () => {
    const { by } = await resultsFor({ issuer: "https://issuer.example/" });

    expect(by("issuer")?.status).toBe("fail");
  });

  it("only warns about a scope the provider does not list, since it may accept it anyway", async () => {
    const { by } = await resultsFor({ scopes: ["openid", "offline_access"] });

    expect(by("scopes")).toMatchObject({
      status: "warn",
      message: expect.stringContaining("offline_access"),
    });
  });

  it("only warns about a claim the provider does not list", async () => {
    const { by } = await resultsFor({ claims: ["email", "nickname"] });

    expect(by("claims")).toMatchObject({
      status: "warn",
      message: expect.stringContaining("nickname"),
    });
  });

  it.each([
    ["scopes", { scopes: [] }],
    ["claims", { claims: [] }],
  ])(
    "skips %s when the connection names none, rather than passing an empty list",
    async (name, overrides) => {
      const { by } = await resultsFor(overrides);

      expect(by(name)?.status).toBe("skipped");
    },
  );

  it.each(["scopes", "claims", "pkce"])(
    "skips %s for a provider that does not advertise it",
    async (name) => {
      const { by } = await resultsFor({}, { issuer: DOCUMENT.issuer });

      expect(by(name)?.status).toBe("skipped");
    },
  );

  it("warns when the provider lists challenge methods without S256", async () => {
    const { by } = await resultsFor(
      {},
      { ...DOCUMENT, code_challenge_methods_supported: ["plain"] },
    );

    expect(by("pkce")?.status).toBe("warn");
  });

  it("uses the endpoint the connection names, and has no discovery document to compare", async () => {
    const { by, asked } = await resultsFor({
      endpoints: { authorization: "https://idp.example/authorize" },
    });

    expect([by("discovery")?.message, by("issuer")?.status, asked]).toEqual([
      "Using the endpoints written in the connection",
      "skipped",
      [expect.stringContaining("https://idp.example/authorize?")],
    ]);
  });

  it("asks the provider about the client and the callback URI, with no user", async () => {
    const { asked } = await resultsFor();

    expect(asked.find((url) => url.startsWith("https://issuer.example/authorize"))).toContain(
      "client_id=the-client&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2F__nextgen%2Fidp%2Facme%2Fcallback",
    );
  });

  it("adds its parameters to an authorization endpoint that already has a query", async () => {
    const { asked } = await resultsFor({
      endpoints: { authorization: "https://idp.example/authorize?prompt=consent" },
    });

    const url = new URL(asked.find((candidate) => candidate.includes("/authorize")) ?? "");

    expect([url.searchParams.get("prompt"), url.searchParams.get("client_id")]).toEqual([
      "consent",
      "the-client",
    ]);
  });

  it.each([
    [
      "redirect_uri",
      "Register http://localhost:3000/__nextgen/idp/acme/callback as a redirect URI at https://console.example",
    ],
    ["client", "Check the client ID against the client registered at https://console.example"],
  ] as const)("tells the developer what to do about a rejected %s", async (problem, recovery) => {
    const rejecting: ProviderProbes = {
      authorize: () => ({ kind: "rejected", problem, reason: "no" }),
    };

    const { by } = await resultsFor({ probes: rejecting });

    expect(by("callback-uri")?.recovery).toBe(recovery);
  });

  it("names the provider's console generically when it has none", async () => {
    const rejecting: ProviderProbes = {
      authorize: () => ({ kind: "rejected", problem: "client", reason: "no" }),
    };

    const { by } = await resultsFor({ probes: rejecting, consoleUrl: undefined });

    expect(by("callback-uri")?.recovery).toContain("the provider's console");
  });

  it("skips the probe, never passes it, when it does not recognise the answer", async () => {
    const baffled: ProviderProbes = { authorize: () => ({ kind: "unknown" }) };

    const { by } = await resultsFor({ probes: baffled });

    expect(by("callback-uri")?.status).toBe("skipped");
  });

  it("skips the probe for a provider with no profile, without asking it anything but its discovery", async () => {
    const { by, asked } = await resultsFor({ probes: undefined });

    expect([by("callback-uri")?.status, asked]).toEqual([
      "skipped",
      ["https://issuer.example/.well-known/openid-configuration"],
    ]);
  });
});
