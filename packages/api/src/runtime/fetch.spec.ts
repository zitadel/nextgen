import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { type CsrfProvider, ZitadelClient, type ZitadelClientSettings } from "./client";
import {
  ApiError,
  CSRF_HEADER,
  DestructiveOperationError,
  NetworkError,
  apiErrorCode,
  customFetch,
} from "./fetch";

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

/** A client on `baseUrl` that may not run destructive operations, with `settings`. */
function clientOf(baseUrl: string, settings: Partial<ZitadelClientSettings> = {}): ZitadelClient {
  return new ZitadelClient({ baseUrl, allowDestructive: false, ...settings });
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

const CSRF_REFUSED: Answer = [403, { code: "auth.csrf_invalid", message: "refused" }];
const CREATED: Answer = [201, { id: "team_1" }];

/** A CSRF provider for `origin` that holds `token` and refreshes to `fresh`, counting refreshes. */
function csrfFor(origin: string, token: string | undefined, fresh?: string) {
  const counted = { refreshes: 0 };
  const provider: CsrfProvider = {
    origin,
    token: () => token,
    refresh: async () => {
      counted.refreshes += 1;
      return fresh;
    },
  };
  return { provider, counted };
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

describe("customFetch destructive guard", () => {
  it("refuses a destructive operation before anything is sent", async () => {
    const { base, seen } = await recording();

    const error = await customFetch(clientOf(base), "deleteUser")("/users/usr_1", {
      method: "DELETE",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DestructiveOperationError);
    expect(error).toMatchObject({ operation: "deleteUser" });
    expect(seen).toEqual([]);
  });

  it("runs a destructive operation for a client that allows it", async () => {
    const { base, seen } = await recording();

    await customFetch(clientOf(base, { allowDestructive: true }), "deleteUser")("/users/usr_1", {
      method: "DELETE",
    });

    expect(seen.map(({ method, path }) => [method, path])).toEqual([
      ["DELETE", "/api/v1/users/usr_1"],
    ]);
  });

  it("runs any other operation for a client that does not allow destructive ones", async () => {
    const { base, seen } = await recording();

    await send(clientOf(base), "/teams", { method: "POST" });

    expect(seen).toHaveLength(1);
  });
});

describe("customFetch CSRF header", () => {
  it("sends the token on unsafe methods", async () => {
    const { base, seen } = await recording();
    const client = clientOf(base, { csrf: csrfFor(base, "tok").provider });

    for (const method of ["POST", "PATCH", "DELETE", "put"]) {
      await send(client, "/x", { method });
    }

    expect(seen.map(({ headers }) => headers["x-zitadel-csrf"])).toEqual([
      "tok",
      "tok",
      "tok",
      "tok",
    ]);
  });

  it("leaves safe methods alone", async () => {
    const { base, seen } = await recording();
    const client = clientOf(base, { csrf: csrfFor(base, "tok").provider });

    await send(client, "/x");
    await send(client, "/x", { method: "GET" });

    expect(seen.map(({ headers }) => "x-zitadel-csrf" in headers)).toEqual([false, false]);
  });

  it("adds nothing when the provider has no token yet", async () => {
    const { base, seen } = await recording();

    await send(clientOf(base, { csrf: csrfFor(base, undefined).provider }), "/x", {
      method: "POST",
    });

    expect("x-zitadel-csrf" in (seen[0]?.headers ?? {})).toBe(false);
  });

  it("adds nothing for a client without a provider", async () => {
    const { base, seen } = await recording();

    await send(clientOf(base), "/x", { method: "POST" });

    expect("x-zitadel-csrf" in (seen[0]?.headers ?? {})).toBe(false);
  });

  it("sends the token only to the origin it was issued for", async () => {
    const issuer = await recording();
    const other = await recording();
    const csrf = csrfFor(issuer.base, "tok").provider;

    await send(clientOf(other.base, { csrf }), "/x", { method: "POST" });
    await send(clientOf(issuer.base, { csrf }), "/x", { method: "POST" });

    expect("x-zitadel-csrf" in (other.seen[0]?.headers ?? {})).toBe(false);
    expect(issuer.seen[0]?.headers["x-zitadel-csrf"]).toBe("tok");
  });

  it("reads the token again on every request", async () => {
    const { base, seen } = await recording();
    let token = "first";
    const client = clientOf(base, {
      csrf: { origin: base, token: () => token, refresh: async () => undefined },
    });

    await send(client, "/x", { method: "POST" });
    token = "second";
    await send(client, "/x", { method: "POST" });

    expect(seen.map(({ headers }) => headers["x-zitadel-csrf"])).toEqual(["first", "second"]);
  });

  it("keeps a header the caller set itself", async () => {
    const { base, seen } = await recording();

    await send(clientOf(base, { csrf: csrfFor(base, "tok").provider }), "/x", {
      method: "POST",
      headers: { [CSRF_HEADER]: "own" },
    });

    expect(seen[0]?.headers["x-zitadel-csrf"]).toBe("own");
  });
});

describe("customFetch CSRF refusal", () => {
  it("retries once with the token the provider hands back", async () => {
    const { base, seen } = await recording([CSRF_REFUSED, CREATED]);
    const client = clientOf(base, { csrf: csrfFor(base, "stale", "fresh").provider });

    await expect(send(client, "/teams", { method: "POST", body: "{}" })).resolves.toEqual({
      id: "team_1",
    });
    expect(seen.map(({ headers }) => headers["x-zitadel-csrf"])).toEqual(["stale", "fresh"]);
  });

  it("recovers a write that went out without a token", async () => {
    const { base, seen } = await recording([CSRF_REFUSED, CREATED]);
    const client = clientOf(base, { csrf: csrfFor(base, undefined, "fresh").provider });

    await expect(send(client, "/teams", { method: "POST" })).resolves.toEqual({ id: "team_1" });
    expect(seen.map(({ headers }) => headers["x-zitadel-csrf"])).toEqual([undefined, "fresh"]);
  });

  // The provider hands back nothing when someone else, or nobody, is signed in
  // now: the write is not replayed under a session it was not prepared for.
  it("does not retry when the provider hands back no token", async () => {
    const { base, seen } = await recording([CSRF_REFUSED]);
    const client = clientOf(base, { csrf: csrfFor(base, "stale").provider });

    await expect(send(client, "/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(seen).toHaveLength(1);
  });

  it("retries at most once", async () => {
    const { base, seen } = await recording([CSRF_REFUSED, CSRF_REFUSED]);
    const { provider, counted } = csrfFor(base, "stale", "fresh");

    await expect(
      send(clientOf(base, { csrf: provider }), "/teams", { method: "POST" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(seen.map(({ headers }) => headers["x-zitadel-csrf"])).toEqual(["stale", "fresh"]);
    expect(counted.refreshes).toBe(1);
  });

  it("does not retry a body that can be read only once", async () => {
    const { base, seen } = await recording([CSRF_REFUSED]);
    const { provider, counted } = csrfFor(base, "stale", "fresh");

    await expect(
      send(clientOf(base, { csrf: provider }), "/teams", {
        method: "POST",
        body: new ReadableStream({ start: (controller) => controller.close() }),
        duplex: "half",
      } as RequestInit),
    ).rejects.toBeInstanceOf(ApiError);
    expect(counted.refreshes).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it("leaves a refusal from another origin alone", async () => {
    const issuer = await recording();
    const other = await recording([CSRF_REFUSED]);
    const { provider, counted } = csrfFor(issuer.base, "tok", "fresh");

    await expect(
      send(clientOf(other.base, { csrf: provider }), "/teams", { method: "POST" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(counted.refreshes).toBe(0);
  });

  it("leaves other 403 answers and safe methods alone", async () => {
    const { base } = await recording([
      [403, { code: "team.permission_denied", message: "no" }],
      CSRF_REFUSED,
    ]);
    const { provider, counted } = csrfFor(base, "tok", "fresh");
    const client = clientOf(base, { csrf: provider });

    await expect(send(client, "/teams", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    await expect(send(client, "/teams", { method: "GET" })).rejects.toBeInstanceOf(ApiError);
    expect(counted.refreshes).toBe(0);
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
