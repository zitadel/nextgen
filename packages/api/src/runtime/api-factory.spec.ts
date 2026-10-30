import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import type { ListDeployments200DeploymentsItem } from "../generated/model";
import { createZitadelClient } from "./api-factory";

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
    for await (const deployment of client.listDeployments.items({ project_id: "proj_1" })) {
      ids.push(deployment.id);
      // Another client's call between two pages must not redirect the next one.
      if (ids.length === 1) await other.listDeployments({ project_id: "proj_2" });
    }

    expect(ids).toEqual(["dep_1", "dep_2"]);
    expect(requests).toEqual([
      ["/deployments?project_id=proj_1", "Bearer secret"],
      ["/deployments?project_id=proj_1&page_token=t1", "Bearer secret"],
    ]);
    expect(elsewhere.requests).toEqual([["/deployments?project_id=proj_2", "Bearer other"]]);
  });

  it("types a paged function's items as the response's list entries", () => {
    const client = createZitadelClient({ baseUrl: "http://127.0.0.1:1" });

    expectTypeOf(client.listDeployments.all).returns.resolves.toEqualTypeOf<
      ListDeployments200DeploymentsItem[]
    >();
  });

  it("leaves paging off a function that does not page", () => {
    const client = createZitadelClient({ baseUrl: "http://127.0.0.1:1" });

    expect("items" in client.getDeploymentById).toBe(false);
  });
});
