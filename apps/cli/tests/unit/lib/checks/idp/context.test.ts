import { describe, expect, it } from "vitest";

import { idpContext, type IdpContext, type Send } from "../../../../../src/lib/checks/idp/context";

const base = (request: Send): Omit<IdpContext, "discovery"> => ({
  slug: "google",
  issuer: "https://issuer.example/",
  clientId: "id",
  clientSecret: undefined,
  scopes: ["openid"],
  claims: [],
  callbackUri: "http://localhost:3000/cb",
  endpoints: undefined,
  consoleUrl: undefined,
  probes: undefined,
  request,
});

describe("idpContext discovery", () => {
  it("reads the document from the issuer's well-known path, ignoring a trailing slash", async () => {
    const asked: string[] = [];
    const context = idpContext(
      base(async (url) => {
        asked.push(url);
        return { status: 200, url, body: '{"issuer":"https://issuer.example"}' };
      }),
    );

    const found = await context.discovery;

    expect(asked).toEqual(["https://issuer.example/.well-known/openid-configuration"]);
    expect(found).toMatchObject({ ok: true, document: { issuer: "https://issuer.example" } });
  });

  it("asks only once however many checks await it", async () => {
    let asks = 0;
    const context = idpContext(
      base(async (url) => {
        asks += 1;
        return { status: 200, url, body: "{}" };
      }),
    );

    await Promise.all([context.discovery, context.discovery]);

    expect(asks).toBe(1);
  });

  it.each([
    [
      "answers with an error status",
      async (url: string) => ({ status: 404, url, body: "" }),
      "answered 404",
    ],
    [
      "does not return JSON",
      async (url: string) => ({ status: 200, url, body: "<html>" }),
      "did not return JSON",
    ],
    [
      "cannot be reached",
      async () => {
        throw new Error("fetch failed");
      },
      "Could not reach",
    ],
  ])("reports a provider that %s without rejecting", async (_name, request, reason) => {
    const found = await idpContext(base(request as Send)).discovery;

    expect(found).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
  });

  it("uses the endpoints the connection names, without asking the provider for a document", async () => {
    let asks = 0;
    const context = idpContext({
      ...base(async (url) => {
        asks += 1;
        return { status: 200, url, body: "{}" };
      }),
      endpoints: {
        authorization: "https://idp.example/authorize",
        token: "https://idp.example/token",
      },
    });

    const found = await context.discovery;

    expect([asks, found]).toEqual([
      0,
      {
        ok: true,
        url: "https://issuer.example/",
        source: "connection",
        document: {
          authorization_endpoint: "https://idp.example/authorize",
          token_endpoint: "https://idp.example/token",
        },
      },
    ]);
  });
});
