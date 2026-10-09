import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getApiCsrfToken, setApiCsrfRejectionHandler, setApiCsrfToken } from "./auth";
import {
  ApiError,
  CSRF_HEADER,
  NetworkError,
  apiErrorCode,
  customFetch,
  request,
  setRequestPolicy,
} from "./fetch";

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

function captureFetch() {
  const seen: Headers[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response(null, { status: 204 });
    }),
  );
  return seen;
}

// The CSRF tests run as a page served from the API's origin, the way the
// console is: the token and the rejection handler default to that origin.
beforeEach(() => {
  vi.stubGlobal("location", new URL("http://api.test/console/"));
});

afterEach(() => {
  setApiCsrfToken(undefined);
  setApiCsrfRejectionHandler(undefined);
  vi.unstubAllGlobals();
});

/** Answers each request with the next response; records the CSRF header sent. */
function scriptedFetch(responses: Array<() => Response>) {
  const sent: Array<string | null> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get(CSRF_HEADER));
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next();
    }),
  );
  return sent;
}

const csrfRefused = () =>
  new Response(JSON.stringify({ code: "auth.csrf_invalid", message: "refused" }), { status: 403 });

describe("customFetch CSRF header", () => {
  it("sends the token on unsafe methods", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    for (const method of ["POST", "PATCH", "DELETE", "put"]) {
      await customFetch("http://api.test/x", { method });
    }
    expect(seen.map((headers) => headers.get(CSRF_HEADER))).toEqual(["tok", "tok", "tok", "tok"]);
  });

  it("leaves safe methods alone", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://api.test/x", {});
    await customFetch("http://api.test/x", { method: "GET" });
    expect(seen.map((headers) => headers.has(CSRF_HEADER))).toEqual([false, false]);
  });

  it("adds nothing when no token is set", async () => {
    const seen = captureFetch();
    await customFetch("http://api.test/x", { method: "POST" });
    expect(seen[0]?.has(CSRF_HEADER)).toBe(false);
  });

  // Another client on the page, with another base URL, must not carry this
  // session's token to a different host.
  it("sends the token only to the origin it was issued for", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://other.test/x", { method: "POST" });
    await customFetch("/api/x", { method: "POST" });
    expect(seen.map((headers) => headers.get(CSRF_HEADER))).toEqual([null, "tok"]);
  });

  it("takes an explicit origin", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok", "http://other.test");
    await customFetch("http://other.test/x", { method: "POST" });
    await customFetch("http://api.test/x", { method: "POST" });
    expect(seen.map((headers) => headers.get(CSRF_HEADER))).toEqual(["tok", null]);
  });

  it("sends nothing when there is no origin to go by", async () => {
    vi.stubGlobal("location", undefined);
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://api.test/x", { method: "POST" });
    expect(seen[0]?.has(CSRF_HEADER)).toBe(false);
  });

  it("keeps a header the caller set itself", async () => {
    const seen = captureFetch();
    setApiCsrfToken("tok");
    await customFetch("http://api.test/x", { method: "POST", headers: { [CSRF_HEADER]: "own" } });
    expect(seen[0]?.get(CSRF_HEADER)).toBe("own");
  });
});

const created = () => new Response(JSON.stringify({ id: "team_1" }), { status: 201 });

describe("customFetch CSRF refusal", () => {
  it("retries once with the token the handler hands back", async () => {
    const sent = scriptedFetch([csrfRefused, created]);
    setApiCsrfToken("stale");
    setApiCsrfRejectionHandler(async () => "fresh");
    await expect(
      customFetch("http://api.test/teams", { method: "POST", body: "{}" }),
    ).resolves.toEqual({
      id: "team_1",
    });
    expect(sent).toEqual(["stale", "fresh"]);
  });

  // The client sets the request policy per call. Another call made while the
  // session is re-checked must not put its signal or deadline on this retry.
  it("retries under the policy the request started with", async () => {
    const responses = [csrfRefused, created];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.signal?.aborted) throw init.signal.reason;
        const next = responses.shift();
        if (!next) throw new Error("unexpected request");
        return next();
      }),
    );
    setApiCsrfToken("stale");
    setApiCsrfRejectionHandler(async () => {
      setRequestPolicy({ signal: AbortSignal.abort(new Error("another call's signal")) });
      return "fresh";
    });
    await expect(customFetch("http://api.test/teams", { method: "POST" })).resolves.toEqual({
      id: "team_1",
    });
  });

  it("recovers a write that went out without a token", async () => {
    const sent = scriptedFetch([csrfRefused, created]);
    setApiCsrfRejectionHandler(async () => "fresh");
    await expect(customFetch("http://api.test/teams", { method: "POST" })).resolves.toEqual({
      id: "team_1",
    });
    expect(sent).toEqual([null, "fresh"]);
  });

  // The handler hands back nothing when someone else, or nobody, is signed in
  // now: the write is not replayed under a session it was not prepared for.
  it("does not retry when the handler hands back no token", async () => {
    const sent = scriptedFetch([csrfRefused]);
    setApiCsrfToken("stale");
    setApiCsrfRejectionHandler(async () => undefined);
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(sent).toEqual(["stale"]);
  });

  it("retries at most once", async () => {
    const sent = scriptedFetch([csrfRefused, csrfRefused]);
    setApiCsrfToken("stale");
    const onRejected = vi.fn(async () => "fresh");
    setApiCsrfRejectionHandler(onRejected);
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(sent).toEqual(["stale", "fresh"]);
    expect(onRejected).toHaveBeenCalledOnce();
  });

  it("does not retry a body that can be read only once", async () => {
    const sent = scriptedFetch([csrfRefused]);
    setApiCsrfToken("stale");
    const onRejected = vi.fn(async () => "fresh");
    setApiCsrfRejectionHandler(onRejected);
    await expect(
      customFetch("http://api.test/teams", { method: "POST", body: new ReadableStream() }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(onRejected).not.toHaveBeenCalled();
    expect(sent).toEqual(["stale"]);
  });

  it("leaves a refusal from another origin alone", async () => {
    scriptedFetch([csrfRefused]);
    setApiCsrfToken("tok");
    const onRejected = vi.fn(async () => "fresh");
    setApiCsrfRejectionHandler(onRejected);
    await expect(customFetch("http://other.test/teams", { method: "POST" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("leaves other 403 answers and safe methods alone", async () => {
    scriptedFetch([
      () =>
        new Response(JSON.stringify({ code: "team.permission_denied", message: "no" }), {
          status: 403,
        }),
      csrfRefused,
    ]);
    setApiCsrfToken("tok");
    const onRejected = vi.fn(async () => "fresh");
    setApiCsrfRejectionHandler(onRejected);
    await expect(customFetch("http://api.test/teams", { method: "POST" })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(customFetch("http://api.test/teams", { method: "GET" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(onRejected).not.toHaveBeenCalled();
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

describe("CSRF token slot", () => {
  it("is shared through globalThis, so another copy of the module sees it", () => {
    setApiCsrfToken("tok");
    const slot = (globalThis as Record<symbol, { token?: string } | undefined>)[
      Symbol.for("@zitadel/api/auth:csrf")
    ];
    expect(slot?.token).toBe("tok");
    if (!slot) throw new Error("the slot must exist once a token was set");
    slot.token = "from-another-copy";
    expect(getApiCsrfToken()).toBe("from-another-copy");
  });
});
