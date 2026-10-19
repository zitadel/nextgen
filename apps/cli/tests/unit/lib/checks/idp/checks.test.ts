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
  it("passes every check for a provider that accepts the connection, except the sign-in it was not asked for", async () => {
    const { by } = await resultsFor();

    expect(IDP_CHECKS.map((check) => by(check.name)?.status)).toEqual([
      ...Array(IDP_CHECKS.length - 1).fill("pass"),
      "skipped",
    ]);
  });

  it("fails discovery, and skips what needs it, for a provider that cannot be read", async () => {
    const { by } = await resultsFor({}, null);

    expect([by("discovery")?.status, by("issuer")?.status, by("callback-uri")?.status]).toEqual([
      "fail",
      "skipped",
      "skipped",
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
