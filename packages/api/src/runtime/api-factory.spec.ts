import { createServer } from "node:http";

import { describe, expect, expectTypeOf } from "vitest";

import { test as it, type Serve } from "../__tests__/fixtures";

import type { ListDeployments200DeploymentsItem } from "../generated/model";
import type { paging } from "../generated/paging";
import { createZitadelClient, type ItemOf } from "./api-factory";

type Paging = typeof paging;

/** Answers `GET /deployments` two pages deep, recording each request's URL and bearer. */
async function deployments(serve: Serve): Promise<{ base: string; requests: string[][] }> {
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
  return { base: await serve(server), requests };
}

/**
 * Answers any paged request two pages deep, its list under `field`, reading the
 * cursor from the query or the JSON body; records each request's path and body.
 */
async function twoPages(
  serve: Serve,
  field: string,
): Promise<{ base: string; requests: unknown[][] }> {
  const requests: unknown[][] = [];
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body: unknown = text === "" ? undefined : JSON.parse(text);
      requests.push([url.pathname + url.search, body]);
      const second = url.search.includes("page_token=t1") || text.includes('"page_token":"t1"');
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ [field]: [], ...(second ? {} : { next_page_token: "t1" }) }));
    });
  });
  return { base: await serve(server), requests };
}

/** Answers any request, recording the `User-Agent` each one carried. */
async function agents(serve: Serve): Promise<{ base: string; seen: (string | undefined)[] }> {
  const seen: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers["user-agent"]);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ deployments: [] }));
  });
  return { base: await serve(server), seen };
}

describe("createZitadelClient", () => {
  it("keeps two clients' user agents apart while both are in flight", async ({ serve }) => {
    const one = await agents(serve);
    const two = await agents(serve);
    const first = createZitadelClient({ baseUrl: one.base, userAgent: "zitadel-cli/first" });
    const second = createZitadelClient({ baseUrl: two.base, userAgent: "zitadel-cli/second" });

    await Promise.all([
      first.listDeployments({ project_id: "proj_1" }),
      second.listDeployments({ project_id: "proj_2" }),
      first.listDeployments({ project_id: "proj_3" }),
    ]);

    expect(one.seen).toEqual(["zitadel-cli/first", "zitadel-cli/first"]);
    expect(two.seen).toEqual(["zitadel-cli/second"]);
  });

  it("walks a paged function's pages with its own base URL and token", async ({ serve }) => {
    const { base, requests } = await deployments(serve);
    const elsewhere = await deployments(serve);
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

  it("keeps two clients' walks apart while both are in flight", async ({ serve }) => {
    const one = await deployments(serve);
    const two = await deployments(serve);
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

  it("sends its user agent on every request", async ({ serve }) => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers["user-agent"] ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ deployments: [] }));
    });
    const client = createZitadelClient({
      baseUrl: await serve(server),
      userAgent: "zitadel-cli/1.0.0",
    });

    await client.listDeployments({
      project_id: "proj_1",
    });

    expect(seen).toEqual(["zitadel-cli/1.0.0"]);
  });

  it("applies its response hook to every page", async ({ serve }) => {
    const { base } = await deployments(serve);
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

  it("applies its hooks when the global Promise has been replaced", async ({ serve }) => {
    const { base } = await deployments(serve);
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

  it("walks every page when its response hook reshapes them", async ({ serve }) => {
    const { base } = await deployments(serve);
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

  it("hands its response hook's failures to its error hook", async ({ serve }) => {
    const { base } = await deployments(serve);
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

  it("puts a later page's page_token in the query parameters after a path parameter", async ({
    serve,
  }) => {
    const { base, requests } = await twoPages(serve, "previews");

    await createZitadelClient({ baseUrl: base }).listProjectPreviews.all("proj_1", { limit: 1 });

    expect(requests.map(([path]) => path)).toEqual([
      "/api/v1/projects/proj_1/previews?limit=1",
      "/api/v1/projects/proj_1/previews?limit=1&page_token=t1",
    ]);
  });

  it("puts a later page's page_token in query parameters the caller left off", async ({
    serve,
  }) => {
    const { base, requests } = await twoPages(serve, "previews");

    await createZitadelClient({ baseUrl: base }).listProjectPreviews.all("proj_1");

    expect(requests.map(([path]) => path)).toEqual([
      "/api/v1/projects/proj_1/previews",
      "/api/v1/projects/proj_1/previews?page_token=t1",
    ]);
  });

  it("puts a later page's page_token in the body of a query", async ({ serve }) => {
    const { base, requests } = await twoPages(serve, "users");

    await createZitadelClient({ baseUrl: base }).queryUsers.all({ limit: 1 });

    expect(requests.map(([, body]) => body)).toEqual([
      { limit: 1 },
      { limit: 1, page_token: "t1" },
    ]);
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

    expect("items" in client.getDeployment).toBe(false);
  });
});
