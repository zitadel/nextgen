import { HttpResponse, http } from "msw";
import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { buildRequest, pathValuesOf, schemaOf, withPathValues } from "@/lib/api-request";
import { createZitadelClient, Operation, OperationService } from "@/lib/backend";
import { toZitadelError } from "@/lib/errors";
import { forcedConsent } from "@tests/helpers/consent";

const signal = new AbortController().signal;

const SERVER = "http://localhost:8080";

const OPERATIONS = Operation.all();

/** Sends a request the way a command does: through a client, unlocked when consent was given. */
const send = async (
  server: string,
  token: string | undefined,
  request: Parameters<OperationService["call"]>[0],
  abort: AbortSignal,
  consent?: Awaited<ReturnType<typeof forcedConsent>>,
) => {
  const client = createZitadelClient({ baseUrl: server, token, signal: abort });
  return new OperationService(consent === undefined ? client : consent.unlock(client)).call(
    request,
  );
};

const sendAll = async (
  server: string,
  token: string | undefined,
  request: Parameters<OperationService["call"]>[0],
  abort: AbortSignal,
) => {
  const client = createZitadelClient({ baseUrl: server, token, signal: abort });
  return new OperationService(client).callAll(request);
};

const requestFor = (ref: string, fields: string[] = [], positionals: string[] = []) => {
  const target = Operation.named(ref);
  return withPathValues(
    buildRequest({
      target,
      fields,
      projectId: "proj_1",
    }),
    pathValuesOf(target, positionals, "proj_1").values,
  );
};

/** Pages of letters, three to a page, behind an opaque cursor. */
const LETTERS = ["a", "b", "c", "d", "e", "f", "g"];
const pageAt = (token: string | null) => {
  const start = token === null ? 0 : Number(token.replace("cursor-", ""));
  const next = start + 3 < LETTERS.length ? `cursor-${start + 3}` : "";
  return { items: LETTERS.slice(start, start + 3), next };
};

describe("OperationService.call", () => {
  it("sends the project secret as the bearer and the body as JSON", async ({ server }) => {
    const seen: { authorization: string | null; type: string | null; body: unknown }[] = [];
    server.use(
      http.post(`${SERVER}/api/v1/teams`, async ({ request }) => {
        seen.push({
          authorization: request.headers.get("authorization"),
          type: request.headers.get("content-type"),
          body: await request.json(),
        });
        return HttpResponse.json({ id: "team_1" }, { status: 201 });
      }),
    );

    const response = await send(
      SERVER,
      "zsec_1",
      requestFor("createTeam", ["name=Support"]),
      signal,
    );

    expect(seen[0]).toEqual({
      authorization: "Bearer zsec_1",
      type: "application/json",
      body: { name: "Support" },
    });
    expect(response).toEqual({ status: 201, body: { id: "team_1" } });
  });

  it("sends no bearer when there is no secret", async ({ server }) => {
    const authorizations: (string | null)[] = [];
    server.use(
      http.get(`${SERVER}/api/v1/livez`, ({ request }) => {
        authorizations.push(request.headers.get("authorization"));
        return HttpResponse.json({ status: "ok" });
      }),
    );

    await send(SERVER, undefined, requestFor("getLive"), signal);

    expect(authorizations[0]).toBeNull();
  });

  it("answers no body for a response without one", async ({ server }) => {
    server.use(
      http.delete(`${SERVER}/api/v1/teams/team_1`, () => new HttpResponse(null, { status: 204 })),
    );

    await expect(
      send(
        SERVER,
        "s",
        requestFor("deactivateTeam", [], ["team_1"]),
        signal,
        await forcedConsent(),
      ),
    ).resolves.toEqual({
      status: 204,
      body: undefined,
    });
  });

  it("refuses a destructive operation without consent", async () => {
    await expect(
      send(SERVER, "s", requestFor("deactivateTeam", [], ["team_1"]), signal),
    ).rejects.toThrow("deactivateTeam is destructive: reach it through allowDestructive");
  });

  it("sends nothing for a destructive operation without consent", async ({ server }) => {
    const sent: string[] = [];
    server.use(
      http.delete(`${SERVER}/api/v1/teams/team_1`, ({ request }) => {
        sent.push(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await send(SERVER, "s", requestFor("deactivateTeam", [], ["team_1"]), signal).catch(
      () => undefined,
    );

    expect(sent).toEqual([]);
  });

  it("sends a merge patch with a null without consent: updates are not guarded", async ({
    server,
  }) => {
    server.use(
      http.patch(`${SERVER}/api/v1/variables`, () => HttpResponse.json({ variables: [] })),
    );

    await expect(
      send(SERVER, "s", requestFor("setVariables", ["FOO:=null", "project_id=proj_1"]), signal),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("answers text for a response that is not JSON", async ({ server }) => {
    server.use(http.get(`${SERVER}/api/v1/livez`, () => HttpResponse.text("alive")));

    await expect(send(SERVER, undefined, requestFor("getLive"), signal)).resolves.toMatchObject({
      body: "alive",
    });
  });

  // The sender translates a transport failure once, where it is sent. A failure
  // that arrived untranslated would reach the CLI unclassified and be reported
  // as a bad request rather than an unreachable server.
  it("raises a request that got no response as unavailable, not as it came", async ({ server }) => {
    server.use(http.get(`${SERVER}/api/v1/livez`, () => HttpResponse.error()));

    const failure = await send(SERVER, undefined, requestFor("getLive"), signal).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ name: "UnavailableError" });
    expect(toZitadelError(failure).code).toBe("E_NETWORK");
  });

  it("answers what the server wrote as it wrote it, for whatever prints it to escape", async ({
    server,
  }) => {
    server.use(
      http.get(`${SERVER}/api/v1/teams/team_1`, () =>
        HttpResponse.json({ name: "\u001b[2Jwiped" }),
      ),
    );

    await expect(
      send(SERVER, "s", requestFor("getTeam", [], ["team_1"]), signal),
    ).resolves.toMatchObject({
      body: { name: "\u001b[2Jwiped" },
    });
  });

  it("fails a refusal as the error the CLI maps to an exit code", async ({ server }) => {
    server.use(
      http.get(`${SERVER}/api/v1/teams/team_1`, () =>
        HttpResponse.json(
          { code: "team.not_found", message: "no \u001b[31mteam" },
          { status: 404 },
        ),
      ),
    );

    const error = await send(SERVER, "s", requestFor("getTeam", [], ["team_1"]), signal).catch(
      (caught: unknown) => caught,
    );

    expect(toZitadelError(error)).toMatchObject({
      code: "E_NOT_FOUND",
      details: { status: 404, body: { code: "team.not_found", message: "no \u001b[31mteam" } },
    });
  });
});

describe("OperationService.callAll", () => {
  it("follows a cursor the query carries and gathers every page", async ({ server }) => {
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, ({ request }) => {
        const { items, next } = pageAt(new URL(request.url).searchParams.get("page_token"));
        return HttpResponse.json({ passkeys: items, next_page_token: next });
      }),
    );

    const response = await sendAll(
      SERVER,
      "s",
      requestFor("listUserPasskeys", [], ["user_1"]),
      signal,
    );

    expect(response.body).toEqual({ passkeys: LETTERS, next_page_token: "" });
  });

  it("follows a cursor the body carries", async ({ server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/users/query`, async ({ request }) => {
        const body = (await request.json()) as { page_token?: string };
        const { items, next } = pageAt(body.page_token ?? null);
        return HttpResponse.json({ users: items, next_page_token: next });
      }),
    );

    const response = await sendAll(SERVER, "s", requestFor("queryUsers", ["limit=3"]), signal);

    expect(response.body).toEqual({ users: LETTERS, next_page_token: "" });
  });

  it("refuses a page without its list, carrying the response", async ({ server }) => {
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, () =>
        HttpResponse.json({ next_page_token: "" }),
      ),
    );

    await expect(
      sendAll(SERVER, "s", requestFor("listUserPasskeys", [], ["user_1"]), signal),
    ).rejects.toMatchObject({
      message: 'Unexpected list response: missing "passkeys" array',
      details: { response: { next_page_token: "" } },
    });
  });

  it("starts from the page the caller named in the query", async ({ server }) => {
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, ({ request }) => {
        const { items, next } = pageAt(new URL(request.url).searchParams.get("page_token"));
        return HttpResponse.json({ passkeys: items, next_page_token: next });
      }),
    );

    const response = await sendAll(
      SERVER,
      "s",
      requestFor("listUserPasskeys", ["page_token=cursor-3"], ["user_1"]),
      signal,
    );

    expect(response.body).toMatchObject({ passkeys: ["d", "e", "f", "g"] });
  });

  it("starts from the page the caller named in the body", async ({ server }) => {
    server.use(
      http.post<never, { page_token?: string }>(
        `${SERVER}/api/v1/users/query`,
        async ({ request }) => {
          const body = await request.json();
          const { items, next } = pageAt(body.page_token ?? null);
          return HttpResponse.json({ users: items, next_page_token: next });
        },
      ),
    );

    const response = await sendAll(
      SERVER,
      "s",
      requestFor("queryUsers", ["page_token=cursor-3"]),
      signal,
    );

    expect(response.body).toMatchObject({ users: ["d", "e", "f", "g"] });
  });

  it("sends a cursor back as the server wrote it, and gathers the items as they came", async ({
    server,
  }) => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, ({ request }) => {
        const token = new URL(request.url).searchParams.get("page_token");
        asked.push(token);
        return HttpResponse.json(
          token === null
            ? { passkeys: ["\u001b[2Ja"], next_page_token: "c\u001b2" }
            : { passkeys: ["b"], next_page_token: "" },
        );
      }),
    );

    const response = await sendAll(
      SERVER,
      "s",
      requestFor("listUserPasskeys", [], ["user_1"]),
      signal,
    );

    expect([asked, response.body]).toEqual([
      [null, "c\u001b2"],
      { passkeys: ["\u001b[2Ja", "b"], next_page_token: "" },
    ]);
  });

  it("answers the last page's other fields as they came, its items in their place", async ({
    server,
  }) => {
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, () =>
        HttpResponse.json({ note: "\u001b[2J", passkeys: ["a"], next_page_token: "" }),
      ),
    );

    const response = await sendAll(
      SERVER,
      "s",
      requestFor("listUserPasskeys", [], ["user_1"]),
      signal,
    );

    expect(JSON.stringify(response.body)).toBe(
      JSON.stringify({ note: "\u001b[2J", passkeys: ["a"], next_page_token: "" }),
    );
  });

  it("keeps two fields of the last page whose names escape alike apart", async ({ server }) => {
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, () =>
        HttpResponse.json({ "\u001bk": 1, "\\x1bk": 2, passkeys: ["a"], next_page_token: "" }),
      ),
    );

    const response = await sendAll(
      SERVER,
      "s",
      requestFor("listUserPasskeys", [], ["user_1"]),
      signal,
    );

    expect(Object.keys(Object(response.body))).toHaveLength(4);
  });
});

const operationById = (id: string) => {
  const operation = OPERATIONS.find((candidate) => candidate.id === id);
  if (!operation) {
    throw new Error(`no operation ${id}`);
  }
  return operation;
};

describe("Operation.all, over the whole table", () => {
  it("names every operation once", () => {
    const ids = OPERATIONS.map((operation) => operation.id.toLowerCase());

    expect(new Set(ids).size).toBe(ids.length);
  });

  // A field is typed by the schema orval generates for the operation; a name
  // it cannot find would leave every field of that operation untyped.
  it("finds the generated body schema of every operation that takes a body", () => {
    const missing = OPERATIONS.filter(
      (operation) => operation.body !== null && schemaOf(operation, "Body") === undefined,
    ).map((operation) => operation.id);

    expect(missing).toEqual([]);
  });

  it("finds the generated query schema of every operation with a query parameter", () => {
    const missing = OPERATIONS.filter(
      (operation) =>
        operation.parameters.some((parameter) => parameter.in === "query") &&
        schemaOf(operation, "QueryParams") === undefined,
    ).map((operation) => operation.id);

    expect(missing).toEqual([]);
  });

  // A field goes to the query when its name is a query parameter and to the
  // body otherwise, which only works while no name is both.
  it("has no query parameter named like a top-level field of the same operation's body", () => {
    const clashes = OPERATIONS.flatMap((operation) => {
      const shape = (schemaOf(operation, "Body") as { shape?: Record<string, unknown> } | undefined)
        ?.shape;
      return operation.parameters
        .filter(
          (parameter) => parameter.in === "query" && shape && Object.hasOwn(shape, parameter.name),
        )
        .map((parameter) => `${operation.id}.${parameter.name}`);
    });

    expect(clashes).toEqual([]);
  });
});

describe("Operation.named", () => {
  it("finds an operation by its id, in any case", () => {
    expect(Operation.named("getuser").operation.id).toBe("getUser");
  });

  it("suggests the operation a typo meant", () => {
    expect(() => Operation.named("querUsers")).toThrow(
      expect.objectContaining({
        hint: expect.stringContaining("queryUsers"),
      }),
    );
  });

  it("refuses a method that is not the operation's", () => {
    expect(() => Operation.named("queryUsers", "GET")).toThrow(
      "queryUsers is POST /users/query, not GET",
    );
  });

  it("finds an operation by a path, reading its parameters from it", () => {
    const target = Operation.named("/users/user_1/passkeys");

    expect(target.operation.id).toBe("listUserPasskeys");
    expect(target.pathValues).toEqual({ user_id: "user_1" });
  });

  it("decodes an escaped path segment", () => {
    expect(Operation.named("/variables/MY%20VAR").pathValues).toEqual({ variable_name: "MY VAR" });
  });

  it("keeps a path's query string apart", () => {
    const target = Operation.named("/events?category=auth&category=session");

    expect(target.operation.id).toBe("listEvents");
    expect(target.query.getAll("category")).toEqual(["auth", "session"]);
  });

  it("prefers the template whose segments are spelled out", () => {
    expect(Operation.named("/users/me").operation.id).toBe("getMyUser");
  });

  it("takes a path's only method without -X", () => {
    expect(Operation.named("/users/query").operation.id).toBe("queryUsers");
  });

  it("takes GET among a path's methods without -X", () => {
    expect(Operation.named("/users/user_1").operation.id).toBe("getUser");
  });

  it("takes the method -X names", () => {
    expect(Operation.named("/users/user_1", "DELETE").operation.id).toBe("deleteUser");
  });

  it("asks for -X where a path has several methods and no GET", () => {
    expect(() => Operation.named("/variables", "PUT")).toThrow(
      "/variables takes GET, PATCH, not PUT",
    );
  });

  it("refuses a path no operation has", () => {
    expect(() => Operation.named("/nothing/here")).toThrow(
      "No operation has the path /nothing/here",
    );
  });

  it("ignores a trailing slash", () => {
    expect(Operation.named("/users/query/").operation.id).toBe("queryUsers");
  });
});

describe("Operation.uncallable", () => {
  it("lets the CLI call what a project secret authenticates", () => {
    expect(operationById("queryUsers").uncallable).toBeUndefined();
  });

  it("lets the CLI call what needs no credential", () => {
    expect(operationById("getLive").uncallable).toBeUndefined();
  });

  it("refuses what only an end user's session authenticates", () => {
    expect(operationById("getMyUser").uncallable).toMatch(/session cookie/);
  });

  it("refuses what reads a cookie only a browser carries", () => {
    expect(operationById("getFlowStep").uncallable).toMatch(/_zflow cookie/);
  });
});

describe("Operation.pathParameters", () => {
  it("lists the parameters in the order the path has them", () => {
    expect(operationById("completeUserPasskeyRegistration").pathParameters).toEqual([
      "user_id",
      "registration_id",
    ]);
  });
});

describe("Operation.all", () => {
  it("finds an operation by a word of its id, path, summary or tag, in any case", () => {
    expect(Operation.all({ filter: "PASSKEY" }).map((operation) => operation.id)).toEqual([
      "listUserPasskeys",
      "createUserPasskeyRegistration",
      "completeUserPasskeyRegistration",
      "listMyPasskeys",
    ]);
  });

  it("keeps to one tag", () => {
    expect(Operation.all({ tag: "system" }).map((operation) => operation.id)).toEqual([
      "getLive",
      "getReady",
    ]);
  });

  it("lists every operation without a filter", () => {
    expect(Operation.all({})).toEqual(OPERATIONS);
  });
});
