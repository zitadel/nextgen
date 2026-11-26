import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { listDeployments } from "../generated/endpoints/zitadelNextGen";
import { createZitadelClient } from "./api-factory";
import { callWith } from "./call";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** Answers any request with an empty list, recording each one's bearer and user agent. */
async function recorder(): Promise<{ base: string; seen: string[][] }> {
  const seen: string[][] = [];
  const server = createServer((req, res) => {
    seen.push([req.headers.authorization ?? "", req.headers["user-agent"] ?? ""]);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ deployments: [] }));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe("callWith", () => {
  it("sends the operation to its base URL with its token", async () => {
    const { base, seen } = await recorder();

    await callWith({ baseUrl: base, token: "pk_1" }, listDeployments, { project_id: "proj_1" });

    expect(seen.map(([bearer]) => bearer)).toEqual(["Bearer pk_1"]);
  });

  it("inherits nothing from the client that ran before it", async () => {
    const { base, seen } = await recorder();
    const aborted = new AbortController();
    const other = createZitadelClient({
      baseUrl: base,
      token: "other",
      userAgent: "other/1",
      signal: aborted.signal,
    });
    await other.listDeployments({ project_id: "proj_1" });
    aborted.abort();

    await callWith({ baseUrl: base }, listDeployments, { project_id: "proj_2" });

    expect(seen[1]?.[0]).toBe("");
    expect(seen[1]?.[1]).not.toBe("other/1");
  });

  it("keeps two callers apart while both are in flight", async () => {
    const one = await recorder();
    const two = await recorder();

    await Promise.all([
      callWith({ baseUrl: one.base, token: "one" }, listDeployments, { project_id: "p" }),
      callWith({ baseUrl: two.base, token: "two" }, listDeployments, { project_id: "p" }),
      callWith({ baseUrl: one.base, token: "one" }, listDeployments, { project_id: "p" }),
    ]);

    expect(one.seen.map(([bearer]) => bearer)).toEqual(["Bearer one", "Bearer one"]);
    expect(two.seen.map(([bearer]) => bearer)).toEqual(["Bearer two"]);
  });
});
