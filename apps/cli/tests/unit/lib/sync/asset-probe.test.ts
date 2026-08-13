import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { annotateAssetWarnings } from "../../../../src/lib/sync/asset-probe";
import { buildSyncPlan } from "../../../../src/lib/sync/loop";
import { collectPlanWarnings } from "../../../../src/lib/sync/plan-renderer";
import type { ResourceSyncer, SyncAction } from "../../../../src/lib/sync/types";

/**
 * Every outbound request the probe makes is intercepted: a sandboxed vitest
 * worker freezes its event loop for ~10s on an unresolvable host, and a JS
 * timeout cannot rescue it. No test here may reach a real network.
 */
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  delete process.env.ZITADEL_SKIP_ASSET_PROBE;
});

function makeSyncer(kind: string): ResourceSyncer {
  return {
    kind,
    directory: `.zitadel/${kind}`,
    mutable: false,
    revisioned: true,
    validate() { /* no-op: probe tests do not exercise validation */ },
    async create() { return { id: "id" }; },
    async update() { return {}; },
    async delete() { /* no-op: probe tests do not exercise delete */ },
  };
}

const branding = makeSyncer("branding");

function reviseBranding(content: object): SyncAction[] {
  return [
    {
      kind: "revise",
      path: ".zitadel/branding/branding.json",
      syncer: branding,
      content,
      hash: "h",
      previousId: "brd_1",
      oldContent: null,
      affectedPaths: [],
    },
  ];
}

function warningsOf(actions: SyncAction[]): ReadonlyArray<{ rule: string; message: string }> {
  const action = actions[0];
  return action.kind === "revise" ? (action.warnings ?? []) : [];
}

describe("annotateAssetWarnings", () => {
  it("stays quiet when the asset serves an image", async () => {
    server.use(
      http.head("https://cdn.example.com/logo.svg", () =>
        HttpResponse.text("", { headers: { "content-type": "image/svg+xml" } }),
      ),
    );
    const actions = reviseBranding({ logo_url: "https://cdn.example.com/logo.svg" });

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions)).toEqual([]);
  });

  // The Elina case: the URL clears the CLI's zod gate and the server's save
  // gate, then renders as a 0×0 <img> with nothing logged anywhere.
  it("warns when the asset 404s", async () => {
    server.use(
      http.head("https://cdn.example.com/logo.svg", () => new HttpResponse(null, { status: 404 })),
    );
    const actions = reviseBranding({ logo_url: "https://cdn.example.com/logo.svg" });

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions)).toHaveLength(1);
    expect(warningsOf(actions)[0].rule).toBe("warn/asset-unreachable");
    expect(warningsOf(actions)[0].message).toContain("logo_url https://cdn.example.com/logo.svg");
    expect(warningsOf(actions)[0].message).toContain("HTTP 404");
  });

  it("warns when the host cannot be reached at all", async () => {
    server.use(http.head("https://gone.example.com/hero.png", () => HttpResponse.error()));
    const actions = reviseBranding({ hero_url: "https://gone.example.com/hero.png" });

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions)[0].rule).toBe("warn/asset-unreachable");
    expect(warningsOf(actions)[0].message).toContain("could not be reached");
    // The probe host is not necessarily the render host, so the warning has
    // to name its own escape hatch.
    expect(warningsOf(actions)[0].message).toContain("ZITADEL_SKIP_ASSET_PROBE");
  });

  it("warns when the URL serves a page instead of an image", async () => {
    server.use(
      http.head("https://cdn.example.com/logo.svg", () =>
        HttpResponse.text("", { headers: { "content-type": "text/html; charset=utf-8" } }),
      ),
    );
    const actions = reviseBranding({ logo_url: "https://cdn.example.com/logo.svg" });

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions)[0].rule).toBe("warn/asset-content-type");
    expect(warningsOf(actions)[0].message).toContain('content-type "text/html"');
  });

  it("stays quiet when the origin refuses HEAD — that says nothing about the asset", async () => {
    server.use(
      http.head("https://cdn.example.com/logo.svg", () => new HttpResponse(null, { status: 405 })),
    );
    const actions = reviseBranding({ logo_url: "https://cdn.example.com/logo.svg" });

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions)).toEqual([]);
  });

  it("warns per field and probes each distinct URL once", async () => {
    let hits = 0;
    server.use(
      http.head("https://cdn.example.com/brand.png", () => {
        hits += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const actions = reviseBranding({
      logo_url: "https://cdn.example.com/brand.png",
      hero_url: "https://cdn.example.com/brand.png",
    });

    await annotateAssetWarnings(actions);

    expect(hits).toBe(1);
    expect(warningsOf(actions).map((w) => w.message.split(" ")[0])).toEqual([
      "logo_url",
      "hero_url",
    ]);
  });

  it("makes no request at all when ZITADEL_SKIP_ASSET_PROBE is set", async () => {
    process.env.ZITADEL_SKIP_ASSET_PROBE = "1";
    // No handler registered: an outbound request would fail the suite under
    // `onUnhandledRequest: "error"`.
    const actions = reviseBranding({ logo_url: "https://cdn.example.com/logo.svg" });

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions)).toEqual([]);
  });

  it("ignores descriptors without asset URLs and non-branding resources", async () => {
    const actions: SyncAction[] = [
      ...reviseBranding({ layout: "split", liquid_template_file: "./login.liquid" }),
      {
        kind: "create",
        path: ".zitadel/flows/default.json",
        syncer: makeSyncer("flow"),
        content: { logo_url: "https://cdn.example.com/not-branding.svg" },
        hash: "h",
      },
    ];

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions)).toEqual([]);
    expect(actions[1].kind === "create" && actions[1].warnings).toBeUndefined();
  });

  it("keeps warnings an earlier pass already attached", async () => {
    server.use(
      http.head("https://cdn.example.com/logo.svg", () => new HttpResponse(null, { status: 404 })),
    );
    const actions = reviseBranding({ logo_url: "https://cdn.example.com/logo.svg" });
    (actions[0] as { warnings?: unknown }).warnings = [{ rule: "warn/other", message: "earlier" }];

    await annotateAssetWarnings(actions);

    expect(warningsOf(actions).map((w) => w.rule)).toEqual(["warn/other", "warn/asset-unreachable"]);
  });
});

describe("buildSyncPlan wiring", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * The plan path, not the probe: a branding edit plans a `revise`, which is
   * the action kind that had nowhere to carry a warning before.
   */
  it("surfaces a dead asset URL as a plan warning on the branding revision", async () => {
    server.use(
      http.head("https://cdn.example.com/logo.svg", () => new HttpResponse(null, { status: 404 })),
    );
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-asset-plan-"));
    dirs.push(cwd);
    await mkdir(join(cwd, ".zitadel/branding"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({
        framework: "next",
        resources: { ".zitadel/branding/branding.json": { id: "brd_1", hash: "stale" } },
      }),
    );
    await writeFile(
      join(cwd, ".zitadel/branding/branding.json"),
      JSON.stringify({ layout: "split", logo_url: "https://cdn.example.com/logo.svg" }),
    );

    const actions = await buildSyncPlan(cwd, [branding]);

    expect(actions.map((a) => a.kind)).toEqual(["revise"]);
    expect(collectPlanWarnings(actions)).toEqual([
      {
        path: ".zitadel/branding/branding.json",
        rule: "warn/asset-unreachable",
        message: expect.stringContaining("HTTP 404"),
      },
    ]);
  });
});
