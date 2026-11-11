import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, vi } from "vitest";

import { brandingAssetWarnings, resolvePublicAddresses } from "@/lib/publish/steps/asset-probe";
import { useUserAgent } from "@/lib/user-agent";
import { it } from "@tests/helpers/fixtures";

/**
 * The resolver the probe asks, answered by each test.
 *
 * @remarks
 * Every lookup and request the probe makes is intercepted: a sandboxed worker
 * freezes its event loop for about ten seconds on an unresolvable host, and no
 * timeout can rescue it.
 */
const { lookup } = vi.hoisted(() => {
  return { lookup: vi.fn() };
});
vi.mock("node:dns/promises", () => {
  return { lookup };
});

/**
 * A public address the resolver answers unless a test says otherwise.
 */
const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 };

/**
 * A logo on a public CDN.
 */
const LOGO = "https://cdn.example.com/logo.svg";

/**
 * How an asset host answers HEAD for an image.
 *
 * @returns The response.
 */
function anImage(): Response {
  return HttpResponse.text("", { headers: { "content-type": "image/svg+xml" } });
}

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue([PUBLIC_ADDRESS]);
});

describe("brandingAssetWarnings", () => {
  it("stays quiet when the asset serves an image", async ({ server }) => {
    server.use(http.head(LOGO, anImage));

    const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warnings).toEqual([]);
  });

  it("identifies the CLI to asset hosts", async ({ server }) => {
    useUserAgent("zitadel-cli/1.0.0");
    const agents: (string | null)[] = [];
    server.use(
      http.head(LOGO, ({ request }) => {
        agents.push(request.headers.get("user-agent"));
        return anImage();
      }),
    );

    await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(agents).toEqual(["zitadel-cli/1.0.0"]);
  });

  it("warns when the asset 404s, naming the field, the URL and the status", async ({ server }) => {
    server.use(
      http.head(LOGO, () => {
        return new HttpResponse(null, { status: 404 });
      }),
    );

    const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warnings).toEqual([expect.stringMatching(new RegExp(`^logo_url ${LOGO}.*HTTP 404`))]);
  });

  it("warns when the host cannot be reached, naming the switch that skips the probe", async ({
    server,
  }) => {
    server.use(
      http.head("https://gone.example.com/hero.png", () => {
        return HttpResponse.error();
      }),
    );

    const warnings = await brandingAssetWarnings([
      { hero_url: "https://gone.example.com/hero.png" },
    ]);

    expect(warnings).toEqual([
      expect.stringMatching(/could not be reached[\s\S]*ZITADEL_SKIP_ASSET_PROBE/),
    ]);
  });

  it("warns when the URL serves a page instead of an image", async ({ server }) => {
    server.use(
      http.head(LOGO, () => {
        return HttpResponse.text("", { headers: { "content-type": "text/html; charset=utf-8" } });
      }),
    );

    const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warnings).toEqual([expect.stringContaining('content-type "text/html"')]);
  });

  it("warns when a successful response is explicitly bodyless", async ({ server }) => {
    server.use(
      http.head(LOGO, () => {
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warnings).toEqual([expect.stringContaining("HTTP 204 with no representation")]);
  });

  it("stays quiet when the origin refuses HEAD, which says nothing about the asset", async ({
    server,
  }) => {
    server.use(
      http.head(LOGO, () => {
        return new HttpResponse(null, { status: 405 });
      }),
    );

    const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

    expect(warnings).toEqual([]);
  });

  it("warns once per field", async ({ server }) => {
    const shared = "https://cdn.example.com/brand.png";
    server.use(
      http.head(shared, () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const warnings = await brandingAssetWarnings([{ logo_url: shared, hero_url: shared }]);

    expect(warnings).toEqual([
      expect.stringMatching(/^logo_url /),
      expect.stringMatching(/^hero_url /),
    ]);
  });

  it("probes a URL two fields share once", async ({ server }) => {
    const shared = "https://cdn.example.com/brand.png";
    const hits = vi.fn();
    server.use(
      http.head(shared, () => {
        hits();
        return new HttpResponse(null, { status: 500 });
      }),
    );

    await brandingAssetWarnings([{ logo_url: shared, hero_url: shared }]);

    expect(hits).toHaveBeenCalledTimes(1);
  });

  it("ignores a descriptor without asset URLs", async () => {
    const warnings = await brandingAssetWarnings([
      { layout: "split", liquid_template: { $file: "./login.liquid" } },
    ]);

    expect(warnings).toEqual([]);
  });

  describe("with ZITADEL_SKIP_ASSET_PROBE set", () => {
    it("makes no request at all", async () => {
      vi.stubEnv("ZITADEL_SKIP_ASSET_PROBE", "1");

      const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

      expect(warnings).toEqual([]);
    });
  });

  describe("with a private destination", () => {
    it.each(["http://127.0.0.1:8080/logo.svg", "https://10.0.0.7/logo.svg"])(
      "does not probe the literal address %s",
      async (url) => {
        const warnings = await brandingAssetWarnings([{ logo_url: url }]);

        expect(warnings).toEqual([]);
      },
    );

    it("does not resolve a literal address", async () => {
      await brandingAssetWarnings([{ logo_url: "https://10.0.0.7/logo.svg" }]);

      expect(lookup).not.toHaveBeenCalled();
    });

    it("re-validates a redirect instead of following it into a private network", async ({
      server,
    }) => {
      const privateHits = vi.fn();
      server.use(
        http.head(LOGO, () => {
          return new HttpResponse(null, {
            status: 302,
            headers: { location: "https://10.0.0.7/internal-logo.svg" },
          });
        }),
        http.head("https://10.0.0.7/internal-logo.svg", () => {
          privateHits();
          return anImage();
        }),
      );

      await brandingAssetWarnings([{ logo_url: LOGO }]);

      expect(privateHits).not.toHaveBeenCalled();
    });

    it("warns about nothing it would not follow", async ({ server }) => {
      server.use(
        http.head(LOGO, () => {
          return new HttpResponse(null, {
            status: 302,
            headers: { location: "https://10.0.0.7/internal-logo.svg" },
          });
        }),
        http.head("https://10.0.0.7/internal-logo.svg", anImage),
      );

      const warnings = await brandingAssetWarnings([{ logo_url: LOGO }]);

      expect(warnings).toEqual([]);
    });
  });
});

describe("resolvePublicAddresses", () => {
  it.each([
    ["a private address", [{ address: "10.0.0.7", family: 4 }]],
    [
      "IPv6 translation addresses that could tunnel to a private IPv4 host",
      [
        { address: "::ffff:10.0.0.7", family: 6 },
        { address: "64:ff9b::a00:7", family: 6 },
      ],
    ],
  ])("rejects a host that resolves to %s", async (_answer, addresses) => {
    lookup.mockResolvedValueOnce(addresses);

    const resolved = await resolvePublicAddresses("assets.internal.example");

    expect(resolved).toBeUndefined();
  });
});
