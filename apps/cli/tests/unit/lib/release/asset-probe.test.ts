import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Agent } from "undici";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  brandingAssetWarnings,
  resolvePublicAddresses,
} from "../../../../src/lib/release/steps/asset-probe";
import { userAgentInterceptor } from "../../../../src/lib/user-agent";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

/**
 * Every outbound request the probe makes is intercepted: a sandboxed vitest
 * worker freezes its event loop for ~10s on an unresolvable host, and a JS
 * timeout cannot rescue it. No test here may reach a real network.
 */
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
afterEach(() => {
  server.resetHandlers();
  delete process.env.ZITADEL_SKIP_ASSET_PROBE;
});

const LOGO = "https://cdn.example.com/logo.svg";

describe("brandingAssetWarnings", () => {
  it("stays quiet when the asset serves an image", async () => {
    server.use(
      http.head(LOGO, () =>
        HttpResponse.text("", { headers: { "content-type": "image/svg+xml" } }),
      ),
    );

    expect(await brandingAssetWarnings([{ logo_url: LOGO }])).toEqual([]);
  });

  // MSW answers above the dispatcher, so assert the wiring rather than the
  // header: the probe's private agent bypasses the global dispatcher and
  // would otherwise send Node's bare `node` user agent.
  it("identifies the CLI to asset hosts", async () => {
    const compose = vi.spyOn(Agent.prototype, "compose");
    try {
      server.use(
        http.head(LOGO, () =>
          HttpResponse.text("", { headers: { "content-type": "image/svg+xml" } }),
        ),
      );

      await brandingAssetWarnings([{ logo_url: LOGO }]);

      expect(compose).toHaveBeenCalledWith(userAgentInterceptor);
    } finally {
      compose.mockRestore();
    }
  });

  // The URL clears the CLI's shape check and the server's save gate, then
  // renders as a 0×0 <img> with nothing logged anywhere.
  it("warns when the asset 404s, naming the field and the status", async () => {
    server.use(http.head(LOGO, () => new HttpResponse(null, { status: 404 })));

    const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`logo_url ${LOGO}`);
    expect(warnings[0]).toContain("HTTP 404");
  });

  it("warns when the host cannot be reached, naming the switch that skips the probe", async () => {
    server.use(http.head("https://gone.example.com/hero.png", () => HttpResponse.error()));

    const [warning] = await brandingAssetWarnings([
      { hero_url: "https://gone.example.com/hero.png" },
    ]);

    expect(warning).toContain("could not be reached");
    expect(warning).toContain("ZITADEL_SKIP_ASSET_PROBE");
  });

  it("warns when the URL serves a page instead of an image", async () => {
    server.use(
      http.head(LOGO, () =>
        HttpResponse.text("", { headers: { "content-type": "text/html; charset=utf-8" } }),
      ),
    );

    const [warning] = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warning).toContain('content-type "text/html"');
  });

  it("warns when a successful response is explicitly bodyless", async () => {
    server.use(http.head(LOGO, () => new HttpResponse(null, { status: 204 })));

    const [warning] = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warning).toContain("HTTP 204 with no representation");
  });

  it("stays quiet when the origin refuses HEAD, which says nothing about the asset", async () => {
    server.use(http.head(LOGO, () => new HttpResponse(null, { status: 405 })));

    expect(await brandingAssetWarnings([{ logo_url: LOGO }])).toEqual([]);
  });

  it("does not probe literal private destinations and rejects private DNS answers", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.7", family: 4 }]);

    const loopback = await brandingAssetWarnings([{ logo_url: "http://127.0.0.1:8080/logo.svg" }]);
    const privateLiteral = await brandingAssetWarnings([{ logo_url: "https://10.0.0.7/logo.svg" }]);
    const privateAddresses = await resolvePublicAddresses("assets.internal.example");

    expect(loopback).toEqual([]);
    expect(privateLiteral).toEqual([]);
    expect(privateAddresses).toBeUndefined();
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("rejects IPv6 translation addresses that could tunnel to a private IPv4 host", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "::ffff:10.0.0.7", family: 6 },
      { address: "64:ff9b::a00:7", family: 6 },
    ]);

    await expect(resolvePublicAddresses("translated.example.com")).resolves.toBeUndefined();
  });

  it("re-validates redirects instead of following them into a private network", async () => {
    let privateHits = 0;
    server.use(
      http.head(
        LOGO,
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { location: "https://10.0.0.7/internal-logo.svg" },
          }),
      ),
      http.head("https://10.0.0.7/internal-logo.svg", () => {
        privateHits += 1;
        return new HttpResponse(null, { headers: { "content-type": "image/svg+xml" } });
      }),
    );

    const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(privateHits).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("warns per field and probes each distinct URL once", async () => {
    let hits = 0;
    server.use(
      http.head("https://cdn.example.com/brand.png", () => {
        hits += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const warnings = await brandingAssetWarnings([
      {
        logo_url: "https://cdn.example.com/brand.png",
        hero_url: "https://cdn.example.com/brand.png",
      },
    ]);

    expect(hits).toBe(1);
    expect(warnings.map((warning) => warning.split(" ")[0])).toEqual(["logo_url", "hero_url"]);
  });

  it("makes no request at all when ZITADEL_SKIP_ASSET_PROBE is set", async () => {
    process.env.ZITADEL_SKIP_ASSET_PROBE = "1";

    // No handler is registered: an outbound request would fail the suite under
    // `onUnhandledRequest: "error"`.
    expect(await brandingAssetWarnings([{ logo_url: LOGO }])).toEqual([]);
  });

  it("ignores a descriptor without asset URLs", async () => {
    expect(
      await brandingAssetWarnings([
        { layout: "split", liquid_template: { $file: "./login.liquid" } },
      ]),
    ).toEqual([]);
  });
});
