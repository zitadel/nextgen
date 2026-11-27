import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { getLive } from "../generated/endpoints/zitadelNextGen";
import { callWith } from "./call";
import { setRequestPolicy } from "./fetch";

const servers: Server[] = [];

afterEach(async () => {
  setRequestPolicy({});
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** Answers every request, recording its path, bearer and user agent. */
async function recorder(): Promise<{ base: string; requests: string[][] }> {
  const requests: string[][] = [];
  const server = createServer((req, res) => {
    requests.push([
      req.url ?? "",
      req.headers.authorization ?? "",
      req.headers["user-agent"] ?? "",
    ]);
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

describe("callWith", () => {
  it("sends the call with its own base URL, bearer and policy, not another client's", async () => {
    const { base, requests } = await recorder();
    setRequestPolicy({ userAgent: "another-client", signal: AbortSignal.abort() });

    await callWith(
      { baseUrl: base, token: "own-key", policy: { userAgent: "own-agent" } },
      getLive,
    );

    expect(requests).toEqual([["/api/v1/livez", "Bearer own-key", "own-agent"]]);
  });
});
