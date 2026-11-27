import { destructiveOperations, operations } from "@zitadel/api/generated/operations";
import { DestructiveOperationError, NetworkError } from "@zitadel/api/runtime/fetch";
import { HttpResponse, http, type JsonBodyType } from "msw";
import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import {
  allowDestructive,
  createZitadelClient,
  responseFailure,
  type ZitadelClient,
} from "@/lib/backend";
import { connectionOf, REQUEST_TIMEOUT_MS, translateFailure } from "@/lib/backend/client";
import { InvalidError } from "@/lib/backend/errors";

const signal = new AbortController().signal;

/**
 * Answers every request to the client's server with one JSON body, status and
 * headers, and records the requests that arrived.
 *
 * @param server - The test's MSW server.
 * @param status - The status to answer with.
 * @param body - The JSON body to answer with.
 * @param headers - Headers to add to the answer.
 * @returns The requests that arrived, oldest first.
 */
function answering(
  server: SetupServer,
  status: number,
  body: JsonBodyType,
  headers: Record<string, string> = {},
): readonly Request[] {
  const arrived: Request[] = [];
  server.use(
    http.all("http://localhost:8080/*", ({ request }) => {
      arrived.push(request);
      return HttpResponse.json(body, { status, headers });
    }),
  );
  return arrived;
}

describe("createZitadelClient", () => {
  const client = () =>
    createZitadelClient({ signal, baseUrl: "http://localhost:8080", token: "t" });

  it("answers a body exactly as the server sent it", async ({ server }) => {
    const body = {
      liquid_template: "<p>\r\n\u200d\u001b[2J</p>",
      nested: {
        tags: ["ok", "\u001b]8;;https://evil.example\u0007click"],
      },
    };
    answering(server, 200, body);

    await expect(client().getProject("p1")).resolves.toEqual(body);
  });

  it("raises a refused response as a BackendError carrying the server's text as it came", async ({
    server,
  }) => {
    answering(server, 400, {
      code: "invalid_argument",
      message: "bad \u001b[31mname",
      details: { details: "\u001b]52;c;cHduZWQ=\u0007" },
    });

    const error = await client()
      .getProject("p1")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(InvalidError);
    expect(error).toMatchObject({
      status: 400,
      body: {
        code: "invalid_argument",
        message: "bad \u001b[31mname",
        details: { details: "\u001b]52;c;cHduZWQ=\u0007" },
      },
    });
  });

  it("carries the server's request id, which finds the request in its logs", async ({ server }) => {
    answering(server, 400, { code: "invalid_argument" }, { "x-request-id": "req_1" });

    await expect(client().getProject("p1")).rejects.toMatchObject({ requestId: "req_1" });
  });
});

describe("a client's destructive operations", () => {
  const client = () =>
    createZitadelClient({ signal, baseUrl: "http://localhost:8080", token: "t" });

  it("are refused before anything is sent", async ({ server }) => {
    const arrived = answering(server, 204, null);

    await expect(client().deleteVariable("NAME", { project_id: "proj_1" })).rejects.toBeInstanceOf(
      DestructiveOperationError,
    );
    expect(arrived).toEqual([]);
  });

  it("are refused by name, whichever one is called", async () => {
    await expect(client().revokeRelease("rel_1", { project_id: "proj_1" })).rejects.toMatchObject({
      operation: "revokeRelease",
    });
  });

  it("leave every other operation reachable, updates included", () => {
    expect(typeof client().getVariable).toBe("function");
    expect(typeof client().setVariables).toBe("function");
  });

  it("are handed back by allowDestructive, on the same connection", () => {
    const allowed = allowDestructive(client());

    expect(allowed.client.allowDestructive).toBe(true);
    expect(connectionOf(allowed)).toMatchObject({ baseUrl: "http://localhost:8080", token: "t" });
  });

  it("are not handed back for a client createZitadelClient did not make", () => {
    expect(() => allowDestructive({} as ZitadelClient)).toThrow(
      "Only a client createZitadelClient made can allow its destructive operations",
    );
  });

  /**
   * The gate has two halves reading two generated shapes: this client narrows
   * itself by `destructiveOperations`, a list of client function names, while
   * `OperationService` asks each operation's own `destructive` flag. They are
   * generated from the one marker in the spec, and nothing else holds them
   * together, so an operation withheld from one caller and not the other would
   * otherwise go unnoticed. Compared without case, because a client function is
   * named after the operation id with its first letter lower-cased.
   */
  it("are the same operations the raw sender refuses", () => {
    const withheld = destructiveOperations.map((name) => {
      return name.toLowerCase();
    });
    const flagged = operations
      .filter((operation) => {
        return operation.destructive;
      })
      .map((operation) => {
        return operation.id.toLowerCase();
      });

    // Both sides are named, so two empty lists cannot agree their way past this.
    expect(withheld).not.toHaveLength(0);
    expect([...withheld].sort()).toEqual([...flagged].sort());
  });
});

describe("responseFailure", () => {
  it.each([
    [404, "NotFoundError"],
    [410, "NotFoundError"],
    [409, "ConflictError"],
    [401, "UnauthorizedError"],
    [403, "ForbiddenError"],
    [400, "InvalidError"],
    [422, "InvalidError"],
    [429, "UnavailableError"],
    [500, "UnavailableError"],
    [503, "UnavailableError"],
  ])("raises a %i as a %s", (status, name) => {
    expect(responseFailure(status, "http://localhost:8080/p", {}, "refused")).toMatchObject({
      name,
      status,
    });
  });

  it("raises a refused origin as invalid rather than a bad credential, since re-authenticating would not fix it", () => {
    expect(
      responseFailure(
        403,
        "http://localhost:8080/p",
        { code: "proj.origin_not_allowed" },
        "refused",
      ),
    ).toMatchObject({ name: "InvalidError" });
  });

  it("carries the status, the URL and the body the server answered with", () => {
    expect(
      responseFailure(409, "http://localhost:8080/p", { code: "dep.conflict" }, "refused"),
    ).toMatchObject({
      status: 409,
      url: "http://localhost:8080/p",
      body: { code: "dep.conflict" },
    });
  });

  it("reads the server's own code off the body", () => {
    expect(
      responseFailure(409, "http://localhost:8080/p", { code: "rel.revoked" }, "refused")
        .serverCode,
    ).toBe("rel.revoked");
  });

  it("reads no code off a body that is not the platform's error envelope", () => {
    expect(
      responseFailure(502, "http://localhost:8080/p", "<html>proxy</html>", "refused").serverCode,
    ).toBeUndefined();
  });

  it("reads no code off an envelope whose code is not a string", () => {
    expect(
      responseFailure(409, "http://localhost:8080/p", { code: 42 }, "refused").serverCode,
    ).toBeUndefined();
  });

  it("reads only the envelope's own code, not one nested under it", () => {
    expect(
      responseFailure(409, "http://localhost:8080/p", { details: { code: "nested" } }, "refused")
        .serverCode,
    ).toBeUndefined();
  });

  it("says what the server said, when the body carries a message", () => {
    expect(
      responseFailure(400, "http://localhost:8080/p", { message: "bad name" }, "refused").message,
    ).toContain("bad name");
  });
});

describe("translateFailure", () => {
  it.each(["unreachable", "timeout", "unreadable"] as const)(
    "raises a request that got no response as unavailable, saying it was %s",
    (reason) => {
      expect(
        translateFailure(new NetworkError("http://localhost:8080", reason, "no answer")),
      ).toMatchObject({ name: "UnavailableError", reason });
    },
  );

  it("carries the URL of a request that got no response", () => {
    expect(
      translateFailure(new NetworkError("http://localhost:8080", "timeout", "no answer")),
    ).toMatchObject({ url: "http://localhost:8080" });
  });

  it("returns a failure that is neither as it came, so a cancelled run keeps its own reason", () => {
    const cancelled = new Error("cancelled");

    expect(translateFailure(cancelled)).toBe(cancelled);
  });
});

describe("connectionOf", () => {
  it("bounds a request by the default a caller did not set", () => {
    const client = createZitadelClient({
      signal,
      baseUrl: "http://localhost:8080",
      token: "t",
    });

    expect(connectionOf(client).timeoutMs).toBe(REQUEST_TIMEOUT_MS);
  });

  it("bounds a request by the deadline a caller set, so a probe gives up before the run does", () => {
    const client = createZitadelClient({
      signal,
      baseUrl: "http://localhost:8080",
      token: "t",
      timeoutMs: 1500,
    });

    expect(connectionOf(client).timeoutMs).toBe(1500);
  });

  /**
   * What the generated client was built with, which is what bounds the
   * requests it makes, beside what `connectionOf` reports: a test that read
   * the connection alone would pass while the client itself went unbounded.
   *
   * @param opts - The options to build a client with.
   * @returns The `timeoutMs` the generated client received, and the connection's.
   */
  function rawTimeoutOf(opts: { timeoutMs?: number | undefined }): {
    raw: number | undefined;
    recorded: number;
  } {
    const client = createZitadelClient({
      signal,
      baseUrl: "http://localhost:8080",
      token: "t",
      ...opts,
    });
    return { raw: client.client.timeoutMs, recorded: connectionOf(client).timeoutMs };
  }

  it.each([
    ["omitted", {}, REQUEST_TIMEOUT_MS],
    ["given as undefined", { timeoutMs: undefined }, REQUEST_TIMEOUT_MS],
    ["given a deadline", { timeoutMs: 1500 }, 1500],
  ])(
    "bounds the generated client and the connection alike, with the deadline %s",
    (_case, opts, expected) => {
      const { raw, recorded } = rawTimeoutOf(opts);

      expect(raw).toBe(expected);
      expect(recorded).toBe(expected);
    },
  );
});
