import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ApiError, customFetch, NetworkError, request, setRequestPolicy } from "./fetch";

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  setRequestPolicy({});
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

async function listening(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A port nothing listens on: bound once to learn a free number, then released. */
async function closedPort(): Promise<string> {
  const server = createServer();
  const url = await listening(server);
  await new Promise((done) => server.close(done));
  servers.splice(servers.indexOf(server), 1);
  return url;
}

/** Accepts the connection and never answers. */
function silent(): Promise<string> {
  return listening(createServer((socket) => sockets.push(socket)));
}

describe("customFetch", () => {
  it("rejects a refused connection with an unreachable NetworkError", async () => {
    const base = await closedPort();

    const error = await customFetch(`${base}/health`, { method: "GET" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ reason: "unreachable", url: `${base}/health` });
    expect((error as Error).message).toBe(`GET ${base}/health got no response (ECONNREFUSED)`);
  });

  it("rejects a server that never answers with a timeout NetworkError", async () => {
    const base = await silent();
    setRequestPolicy({ timeoutMs: 50 });

    const error = await customFetch(`${base}/health`, { method: "GET" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ reason: "timeout" });
  });

  it("rejects with the caller's abort reason when the policy signal fires", async () => {
    const base = await silent();
    const controller = new AbortController();
    const cancelled = new Error("cancelled by the user");
    setRequestPolicy({ signal: controller.signal });

    const pending = customFetch(`${base}/health`, { method: "GET" }).catch((e: unknown) => e);
    controller.abort(cancelled);

    expect(await pending).toBe(cancelled);
  });

  it("treats a per-call timeout signal as a timeout", async () => {
    const base = await silent();

    const error = await customFetch(`${base}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(50),
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ name: "NetworkError", reason: "timeout" });
  });

  it("still rejects a failing status with an ApiError", async () => {
    const http = createHttpServer((_req, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "unavailable", message: "down" }));
    });
    const base = await listening(http as unknown as Server);

    const error = await customFetch(`${base}/health`, { method: "GET" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503 });
  });
});

describe("request", () => {
  it("is bound only by the policy it is given, not by a client's", async () => {
    const base = await silent();
    setRequestPolicy({ timeoutMs: 10 });

    const outcome = await Promise.race([
      request(`${base}/x`, { method: "GET" }).then(
        () => "settled",
        () => "settled",
      ),
      new Promise((done) => setTimeout(() => done("still waiting"), 100)),
    ]);

    expect(outcome).toBe("still waiting");
  });
});
