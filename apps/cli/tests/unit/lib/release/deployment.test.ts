import { describe, expect, it } from "vitest";

import {
  listLiveDeployments,
  newestDeploymentTo,
  rollbackOrigins,
  servesPrimary,
} from "../../../../src/lib/release/deployment";

/** A client whose live list is split over pages of one deployment each. */
function pagedClient(ids: string[]) {
  const seen: Array<Record<string, unknown>> = [];
  return {
    seen,
    client: {
      listDeployments: async (params: Record<string, unknown>) => {
        seen.push(params);
        const index = params.page_token === undefined ? 0 : Number(params.page_token);
        return {
          deployments: [{ id: ids[index], targets: [] }],
          next_page_token: index + 1 < ids.length ? String(index + 1) : null,
        };
      },
    } as never,
  };
}

describe("listLiveDeployments", () => {
  it("drains every page", async () => {
    const { client } = pagedClient(["dep_1", "dep_2", "dep_3"]);

    const live = await listLiveDeployments(client, "proj_1");

    expect(live.map((deployment) => deployment.id)).toEqual(["dep_1", "dep_2", "dep_3"]);
  });

  it("asks only for live deployments, narrowed to an origin when given", async () => {
    const { client, seen } = pagedClient(["dep_1"]);

    await listLiveDeployments(client, "proj_1", { origin: "https://app.acme.com" });

    expect(seen[0]).toMatchObject({
      project_id: "proj_1",
      live: true,
      origin: "https://app.acme.com",
    });
  });
});

describe("servesPrimary", () => {
  it("is true for a deployment with an unexpiring target", () => {
    expect(servesPrimary({ targets: [{ origin: "https://a", expires_at: null }] } as never)).toBe(
      true,
    );
  });

  it("is false for a deployment to the default target alone", () => {
    expect(servesPrimary({ targets: [{ origin: "default", expires_at: null }] } as never)).toBe(
      false,
    );
  });

  it("is true for a deployment to primary and default", () => {
    expect(
      servesPrimary({
        targets: [
          { origin: "default", expires_at: null },
          { origin: "https://a", expires_at: null },
        ],
      } as never),
    ).toBe(true);
  });

  it("is false for a preview deployment", () => {
    expect(
      servesPrimary({
        targets: [{ origin: "https://pr-1", expires_at: "2026-12-01T00:00:00Z" }],
      } as never),
    ).toBe(false);
  });

  it("is false for a deployment to the default target alone", () => {
    expect(servesPrimary({ targets: [{ origin: "default", expires_at: null }] } as never)).toBe(
      false,
    );
  });

  it("is true for a deployment to a primary origin and the default target", () => {
    expect(
      servesPrimary({
        targets: [
          { origin: "default", expires_at: null },
          { origin: "https://a", expires_at: null },
        ],
      } as never),
    ).toBe(true);
  });
});

describe("newestDeploymentTo", () => {
  const newestFirst = [
    { id: "dep_preview", targets: [{ origin: "https://pr-1" }] },
    { id: "dep_default", targets: [{ origin: "default" }] },
    { id: "dep_primary", targets: [{ origin: "https://a" }] },
  ];

  it("is the newest deployment to any of the origins", () => {
    expect(newestDeploymentTo(newestFirst, ["https://a", "default"])).toBe("dep_default");
    expect(newestDeploymentTo(newestFirst, ["https://a"])).toBe("dep_primary");
  });

  it("is undefined when nothing went to the origins", () => {
    expect(newestDeploymentTo(newestFirst, ["https://b"])).toBeUndefined();
  });
});

describe("rollbackOrigins", () => {
  const primaries = ["https://a", "https://b"];

  it("is the current primary origins and the default target for a deployment that served both", () => {
    expect(
      rollbackOrigins(
        { targets: [{ origin: "default" }, { origin: "https://a" }] } as never,
        primaries,
      ),
    ).toEqual(["https://a", "https://b", "default"]);
  });

  it("leaves the default target out for a deployment that did not serve it", () => {
    expect(rollbackOrigins({ targets: [{ origin: "https://a" }] } as never, primaries)).toEqual(
      primaries,
    );
  });

  it("is the default target alone for a deployment that served only it", () => {
    expect(rollbackOrigins({ targets: [{ origin: "default" }] } as never, primaries)).toEqual([
      "default",
    ]);
  });
});
