import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ZitadelClient, type ZitadelClientSettings, type ZitadelRequest } from "./client";
import { ApiError, NetworkError, apiErrorCode, customFetch } from "./fetch";

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
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

/** A client on `baseUrl`, with `settings`. */
function clientOf(baseUrl: string, settings: Partial<ZitadelClientSettings> = {}): ZitadelClient {
  return new ZitadelClient({ ...settings, baseUrl });
}

/** `path` sent by `client` as the generated `createTeam` sends it. */
function send(client: ZitadelClient, path: string, init: RequestInit = {}): Promise<unknown> {
  return customFetch(client, "createTeam")(path, init);
}

describe("customFetch", () => {
  it("rejects a refused connection with an unreachable NetworkError", async () => {
    const base = await closedPort();

    const error = await send(clientOf(base), "/health", { method: "GET" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ reason: "unreachable", url: `${base}/api/v1/health` });
    expect((error as Error).message).toBe(
      `GET ${base}/api/v1/health got no response (ECONNREFUSED)`,
    );
  });

  it("rejects a server that never answers with a timeout NetworkError", async () => {
    const base = await silent();

    const error = await send(clientOf(base, { timeoutMs: 50 }), "/health", { method: "GET" }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ reason: "timeout" });
  });

  it("rejects with the caller's abort reason when the policy signal fires", async () => {
    const base = await silent();
    const controller = new AbortController();
    const cancelled = new Error("cancelled by the user");

    const pending = send(clientOf(base, { signal: controller.signal }), "/health", {
      method: "GET",
    }).catch((e: unknown) => e);
    controller.abort(cancelled);

    expect(await pending).toBe(cancelled);
  });

  it("treats a per-call timeout signal as a timeout", async () => {
    const base = await silent();

    const error = await send(clientOf(base), "/health", {
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

    const error = await send(clientOf(base), "/health", { method: "GET" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, requestId: undefined });
  });

  it("says a server without the operation may predate the API prefix", async () => {
    const http = createHttpServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "req.not_found", message: "not found" }));
    });
    const base = await listening(http as unknown as Server);

    const error = await send(clientOf(base), "/users/me", { method: "GET" }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as Error).message).toBe(
      `GET ${base}/api/v1/users/me returned 404 (req.not_found): the server has no such operation; a server older than this client does not serve the API under /api/v1`,
    );
  });

  it("keeps the plain message for a resource that is not there", async () => {
    const http = createHttpServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "usr.not_found", message: "not found" }));
    });
    const base = await listening(http as unknown as Server);

    const error = await send(clientOf(base), "/users/usr_1", { method: "GET" }).catch(
      (e: unknown) => e,
    );

    expect((error as Error).message).toBe(`GET ${base}/api/v1/users/usr_1 returned 404`);
  });

  it("rejects an answer whose body cannot be read as unreadable, not as no response", async () => {
    // A proxy that forwards `content-encoding` over a body fetch already
    // decoded: the status arrives, the body fails to decode (#2466).
    const http = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.end(JSON.stringify({ session: { user_id: "usr_1" } }));
    });
    const base = await listening(http as unknown as Server);

    const error = await send(clientOf(base), "/sessions/exchange", { method: "POST" }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ reason: "unreadable", url: `${base}/api/v1/sessions/exchange` });
    expect((error as Error).message).toMatch(
      new RegExp(
        `^POST ${base}/api/v1/sessions/exchange answered 200, but its body could not be read`,
      ),
    );
  });

  it("keeps the server's request ID on the ApiError", async () => {
    const http = createHttpServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json", "x-request-id": "req_01TEST" });
      res.end(JSON.stringify({ code: "req.invalid", message: "invalid" }));
    });
    const base = await listening(http as unknown as Server);

    const error = await send(clientOf(base), "/users", { method: "GET" }).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 400, requestId: "req_01TEST" });
  });
});

/** One request a {@link recording} server received. */
type Seen = Readonly<{ method: string; path: string; headers: IncomingHttpHeaders }>;

/** An answer a {@link recording} server gives: a status and a JSON body. */
type Answer = readonly [status: number, body?: unknown];

/**
 * A server that records every request and answers each with the next of
 * `answers`, then `204` once they run out.
 */
async function recording(answers: Answer[] = []): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const http = createHttpServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers });
      const [status, body] = answers.shift() ?? [204];
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    });
  });
  return { base: await listening(http as unknown as Server), seen };
}

describe("customFetch with two clients", () => {
  it("never lets one client's settings reach the other's requests", async () => {
    const one = await recording();
    const two = await recording();
    const first = clientOf(one.base, { token: "one", userAgent: "agent/one" });
    const second = clientOf(two.base, { token: "two", userAgent: "agent/two" });

    await Promise.all([
      send(first, "/a", { method: "GET" }),
      send(second, "/b", { method: "GET" }),
      send(first, "/c", { method: "GET" }),
    ]);

    expect(
      one.seen.map(({ path, headers }) => [path, headers.authorization, headers["user-agent"]]),
    ).toEqual([
      ["/api/v1/a", "Bearer one", "agent/one"],
      ["/api/v1/c", "Bearer one", "agent/one"],
    ]);
    expect(
      two.seen.map(({ path, headers }) => [path, headers.authorization, headers["user-agent"]]),
    ).toEqual([["/api/v1/b", "Bearer two", "agent/two"]]);
  });

  it("never puts one client's deadline on the other's requests", async () => {
    const base = await silent();
    const bounded = clientOf(base, { timeoutMs: 20 });
    const unbounded = clientOf(base);

    const outcome = await Promise.race([
      Promise.all([
        send(bounded, "/x").catch(() => "timed out"),
        send(unbounded, "/x").then(
          () => "settled",
          () => "settled",
        ),
      ]),
      new Promise((done) => setTimeout(() => done("still waiting"), 150)),
    ]);

    expect(outcome).toBe("still waiting");
  });

  it("never lets one client's signal abort the other's requests", async () => {
    const base = await recording([[200, { ok: true }]]);
    const cancelled = clientOf(base.base, { signal: AbortSignal.abort(new Error("cancelled")) });

    await expect(send(cancelled, "/x")).rejects.toThrow("cancelled");
    await expect(send(clientOf(base.base), "/x")).resolves.toEqual({ ok: true });
  });

  it("keeps a header the caller set over the client's bearer", async () => {
    const { base, seen } = await recording();

    await send(clientOf(base, { token: "client" }), "/x", {
      headers: { authorization: "Bearer own" },
    });

    expect(seen[0]?.headers.authorization).toBe("Bearer own");
  });
});

describe("customFetch through the client's fetch", () => {
  /** A `fetch` that adds `name: value` to every request it sends. */
  function adding(name: string, value: string): typeof fetch {
    return (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set(name, value);
      return fetch(input, { ...init, headers });
    };
  }

  it("sends every request through it, with the full URL", async () => {
    const { base, seen } = await recording();

    await send(clientOf(base, { fetch: adding("x-app", "console") }), "/teams", { method: "POST" });

    expect(seen.map(({ path, headers }) => [path, headers["x-app"]])).toEqual([
      ["/api/v1/teams", "console"],
    ]);
  });

  it("is never used by another client", async () => {
    const { base, seen } = await recording();
    const wrapped = clientOf(base, { fetch: adding("x-app", "console") });

    await Promise.all([send(wrapped, "/a"), send(clientOf(base), "/b")]);

    expect(
      seen
        .map(({ path, headers }) => [path, headers["x-app"]])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["/api/v1/a", "console"],
      ["/api/v1/b", undefined],
    ]);
  });

  it("reads what it answers as the server's answer", async () => {
    const answered: typeof fetch = async () => {
      return new Response(JSON.stringify({ code: "team.permission_denied" }), { status: 403 });
    };

    const error = await send(clientOf("http://127.0.0.1:1", { fetch: answered }), "/x").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(apiErrorCode(error)).toBe("team.permission_denied");
  });
});

describe("customFetch through the client's onRequest", () => {
  it("shows it the operation, the full URL and the request before sending", async () => {
    const { base, seen } = await recording();
    const shown: ZitadelRequest[] = [];
    const client = clientOf(base, {
      token: "tok",
      onRequest: (request) => {
        shown.push(request);
      },
    });

    await send(client, "/teams", { method: "POST" });

    expect(
      shown.map(({ operation, url, init }) => [
        operation,
        url,
        init.method,
        new Headers(init.headers).get("authorization"),
      ]),
    ).toEqual([["createTeam", `${base}/api/v1/teams`, "POST", "Bearer tok"]]);
    expect(seen).toHaveLength(1);
  });

  it("sends nothing when it throws, and rejects with what it threw", async () => {
    const { base, seen } = await recording();
    const refused = new Error("not allowed");
    const client = clientOf(base, {
      onRequest: () => {
        throw refused;
      },
    });

    const error = await send(client, "/teams", { method: "POST" }).catch((e: unknown) => e);

    expect(error).toBe(refused);
    expect(seen).toEqual([]);
  });
});

describe("apiErrorCode", () => {
  it("reads the envelope code from an ApiError or a parsed body", () => {
    expect(apiErrorCode(new ApiError(403, "u", { code: "auth.csrf_invalid" }, "m"))).toBe(
      "auth.csrf_invalid",
    );
    expect(apiErrorCode({ code: "user.not_found" })).toBe("user.not_found");
    expect(apiErrorCode({ raw: "<html>" })).toBeUndefined();
    expect(apiErrorCode(new Error("x"))).toBeUndefined();
  });
});
