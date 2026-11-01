import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import type { ListDeployments200DeploymentsItem } from "../generated/model";
import { paging } from "../generated/paging";
import { createZitadelClient, type ItemOf } from "./api-factory";

type Paging = typeof paging;

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** Answers `GET /deployments` two pages deep, recording each request's URL and bearer. */
async function deployments(): Promise<{ base: string; requests: string[][] }> {
  const requests: string[][] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push([url.pathname + url.search, req.headers.authorization ?? ""]);
    const second = url.searchParams.get("page_token") === "t1";
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        deployments: [{ id: second ? "dep_2" : "dep_1" }],
        ...(second ? {} : { next_page_token: "t1" }),
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

describe("createZitadelClient", () => {
  it("walks a paged function's pages with its own base URL and token", async () => {
    const { base, requests } = await deployments();
    const elsewhere = await deployments();
    const client = createZitadelClient({ baseUrl: base, token: "secret" });
    const other = createZitadelClient({ baseUrl: elsewhere.base, token: "other" });

    const ids = [];
    for await (const deployment of client.listDeployments.items({
      project_id: "proj_1",
    })) {
      ids.push(deployment.id);
      // Another client's call between two pages must not redirect the next one.
      if (ids.length === 1) {
        await other.listDeployments({
          project_id: "proj_2",
        });
      }
    }

    expect(ids).toEqual(["dep_1", "dep_2"]);
    expect(requests).toEqual([
      ["/api/v1/deployments?project_id=proj_1", "Bearer secret"],
      ["/api/v1/deployments?project_id=proj_1&page_token=t1", "Bearer secret"],
    ]);
    expect(elsewhere.requests).toEqual([["/api/v1/deployments?project_id=proj_2", "Bearer other"]]);
  });

  it("keeps two clients' walks apart while both are in flight", async () => {
    const one = await deployments();
    const two = await deployments();
    const first = createZitadelClient({ baseUrl: one.base, token: "one" });
    const second = createZitadelClient({ baseUrl: two.base, token: "two" });

    await Promise.all([
      first.listDeployments.all({
        project_id: "proj_1",
      }),
      second.listDeployments.all({
        project_id: "proj_2",
      }),
    ]);

    expect([one.requests, two.requests]).toEqual([
      [
        ["/api/v1/deployments?project_id=proj_1", "Bearer one"],
        ["/api/v1/deployments?project_id=proj_1&page_token=t1", "Bearer one"],
      ],
      [
        ["/api/v1/deployments?project_id=proj_2", "Bearer two"],
        ["/api/v1/deployments?project_id=proj_2&page_token=t1", "Bearer two"],
      ],
    ]);
  });

  it("types a paged function's items as the response's list entries", () => {
    const client = createZitadelClient({ baseUrl: "http://127.0.0.1:1" });

    expectTypeOf(client.listDeployments.all).returns.resolves.toEqualTypeOf<
      ListDeployments200DeploymentsItem[]
    >();
  });

  it("applies its response hook to every page", async () => {
    const { base } = await deployments();
    const client = createZitadelClient({
      baseUrl: base,
      onResponse: (body) => ({
        ...(body as object),
        deployments: (body as { deployments: { id: string }[] }).deployments.map((d) => ({
          id: d.id.toUpperCase(),
        })),
      }),
    });

    const listed = await client.listDeployments.all({
      project_id: "proj_1",
    });

    expect(listed.map((deployment) => deployment.id)).toEqual(["DEP_1", "DEP_2"]);
  });

  it("applies its hooks when the global Promise has been replaced", async () => {
    const { base } = await deployments();
    const seen: unknown[] = [];
    const client = createZitadelClient({
      baseUrl: base,
      onResponse: (body) => {
        seen.push(body);
        return body;
      },
    });
    const Native = globalThis.Promise;
    // As zone.js does: a subclass the engine's own promises are not instances of.
    globalThis.Promise = class extends Native<unknown> {} as PromiseConstructor;
    try {
      await client.listDeployments({
        project_id: "proj_1",
      });
    } finally {
      globalThis.Promise = Native;
    }

    expect(seen).toHaveLength(1);
  });

  it("walks every page when its response hook reshapes them", async () => {
    const { base } = await deployments();
    const client = createZitadelClient({
      baseUrl: base,
      onResponse: (body) => {
        const { next_page_token: nextPageToken, ...rest } = body as Record<string, unknown>;
        return { ...rest, nextPageToken };
      },
    });

    const listed = await client.listDeployments.all({
      project_id: "proj_1",
    });

    expect(listed).toHaveLength(2);
  });

  it("hands its response hook's failures to its error hook", async () => {
    const { base } = await deployments();
    const client = createZitadelClient({
      baseUrl: base,
      onResponse: () => {
        throw new Error("hook");
      },
      onError: () => {
        throw new Error("handled");
      },
    });

    const listed = client.listDeployments({
      project_id: "proj_1",
    });

    await expect(listed).rejects.toThrow("handled");
  });

  it("hands every failure to its error hook", async () => {
    const client = createZitadelClient({
      baseUrl: "http://127.0.0.1:1",
      onError: () => {
        throw new Error("handled");
      },
    });

    const listed = client.listDeployments.all({
      project_id: "proj_1",
    });

    await expect(listed).rejects.toThrow("handled");
  });

  it.each([
    [
      "the query parameters after a path parameter",
      paging.listPreviews.withToken(["proj_1", { limit: 1 }], "t1"),
      ["proj_1", { limit: 1, page_token: "t1" }, undefined],
    ],
    [
      "query parameters the caller left off",
      paging.listPreviews.withToken(["proj_1"], "t1"),
      ["proj_1", { page_token: "t1" }, undefined],
    ],
    [
      "the body of a query",
      paging.queryUsers.withToken([{ limit: 1 }], "t1"),
      [{ limit: 1, page_token: "t1" }, undefined, undefined],
    ],
  ])("puts a later page's page_token on %s", (_, args, expected) => {
    expect(args).toEqual(expected);
  });

  it("types every paged function's items", () => {
    // A list field the generated types lost or renamed fails here, naming the function.
    type Untyped = {
      // A missing field leaves the items `unknown`, a field that is not an array `never`.
      [K in keyof Paging]: [ItemOf<K>] extends [never] ? K : unknown extends ItemOf<K> ? K : never;
    }[keyof Paging];

    expectTypeOf<Untyped>().toBeNever();
  });

  it("builds a URL against its own base URL", () => {
    const client = createZitadelClient({ baseUrl: "http://127.0.0.1:1/" });

    const url = client.getListDeploymentsUrl({
      project_id: "proj_1",
    });

    expect(url).toBe("http://127.0.0.1:1/api/v1/deployments?project_id=proj_1");
  });

  it("leaves paging off a function that does not page", () => {
    const client = createZitadelClient({ baseUrl: "http://127.0.0.1:1" });

    expect("items" in client.getDeploymentById).toBe(false);
  });
});
