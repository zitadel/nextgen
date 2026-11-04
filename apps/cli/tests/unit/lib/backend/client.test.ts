import { NetworkError } from "@zitadel/api/runtime/fetch";
import { describe, expect, it, vi } from "vitest";

import {
  allowDestructive,
  createZitadelClient,
  responseFailure,
  type ZitadelClient,
} from "../../../../src/lib/backend";
import {
  connectionOf,
  REQUEST_TIMEOUT_MS,
  translateFailure,
} from "../../../../src/lib/backend/client";
import { InvalidError } from "../../../../src/lib/backend/errors";

const signal = new AbortController().signal;

/** Answer every request with one JSON body and status. */
function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("createZitadelClient", () => {
  const client = () =>
    createZitadelClient({ signal, baseUrl: "http://localhost:8080", token: "t" });

  it("answers a body exactly as the server sent it", async () => {
    const body = {
      liquid_template: "<p>\r\n\u200d\u001b[2J</p>",
      nested: {
        tags: ["ok", "\u001b]8;;https://evil.example\u0007click"],
      },
    };
    stubFetch(200, body);

    await expect(client().getProject("p1")).resolves.toEqual(body);
  });

  it("raises a refused response as a BackendError carrying the server's text as it came", async () => {
    stubFetch(400, {
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

  it("carries the server's request id, which finds the request in its logs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "invalid_argument" }), {
            status: 400,
            headers: { "x-request-id": "req_1" },
          }),
      ),
    );

    await expect(client().getProject("p1")).rejects.toMatchObject({ requestId: "req_1" });
  });
});

describe("a client's destructive operations", () => {
  const client = () =>
    createZitadelClient({ signal, baseUrl: "http://localhost:8080", token: "t" });

  it("are refused on the client, cast or not", () => {
    expect(() => (client() as unknown as Record<string, unknown>).deleteVariable).toThrow(
      "deleteVariable is destructive: reach it through allowDestructive",
    );
  });

  it("are refused when reached around the type", () => {
    expect(() => Reflect.get(client(), "revokeRelease")).toThrow(
      "revokeRelease is destructive: reach it through allowDestructive",
    );
  });

  it("are refused when reached through the property descriptor", () => {
    expect(() => Object.getOwnPropertyDescriptor(client(), "deleteVariable")).toThrow(
      "deleteVariable is destructive: reach it through allowDestructive",
    );
  });

  it("leave every other operation reachable, updates included", () => {
    expect(typeof client().getVariable).toBe("function");
    expect(typeof client().updateVariables).toBe("function");
  });

  it("are handed back by allowDestructive", () => {
    expect(typeof allowDestructive(client()).deleteVariable).toBe("function");
  });

  it("are not handed back for a client createZitadelClient did not make", () => {
    expect(() => allowDestructive({} as ZitadelClient)).toThrow(
      "Only a client createZitadelClient made can allow its destructive operations",
    );
  });
});

describe("responseFailure", () => {
  it.each([
    [404, "NotFoundError"],
    [409, "ConflictError"],
    [401, "UnauthorizedError"],
    [403, "ForbiddenError"],
    [400, "InvalidError"],
    [422, "InvalidError"],
    [429, "InvalidError"],
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
});
