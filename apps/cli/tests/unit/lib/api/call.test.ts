import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { send, sendAll } from "../../../../src/lib/api/call";
import { resolveTarget } from "../../../../src/lib/api/operations";
import { buildRequest, pathValuesOf } from "../../../../src/lib/api/request";
import { toZitadelError } from "../../../../src/lib/errors";

const SERVER = "http://localhost:8080";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const requestFor = (ref: string, fields: string[] = [], positionals: string[] = []) => {
  const target = resolveTarget(ref);
  return buildRequest({
    target,
    pathValues: pathValuesOf(target, positionals, "proj_1").values,
    fields,
    projectId: "proj_1",
  });
};

/** Pages of letters, three to a page, behind an opaque cursor. */
const LETTERS = ["a", "b", "c", "d", "e", "f", "g"];
const pageAt = (token: string | null) => {
  const start = token === null ? 0 : Number(token.replace("cursor-", ""));
  const next = start + 3 < LETTERS.length ? `cursor-${start + 3}` : "";
  return { items: LETTERS.slice(start, start + 3), next };
};

describe("send", () => {
  it("sends the project secret as the bearer and the body as JSON", async () => {
    let seen: { authorization: string | null; type: string | null; body: unknown } | undefined;
    server.use(
      http.post(`${SERVER}/api/v1/teams`, async ({ request }) => {
        seen = {
          authorization: request.headers.get("authorization"),
          type: request.headers.get("content-type"),
          body: await request.json(),
        };
        return HttpResponse.json({ id: "team_1" }, { status: 201 });
      }),
    );

    const response = await send(SERVER, "zsec_1", requestFor("createTeam", ["name=Support"]));

    expect(seen).toEqual({
      authorization: "Bearer zsec_1",
      type: "application/json",
      body: { name: "Support" },
    });
    expect(response).toEqual({ status: 201, body: { id: "team_1" } });
  });

  it("sends no bearer when there is no secret", async () => {
    let authorization: string | null = "unset";
    server.use(
      http.get(`${SERVER}/api/v1/livez`, ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({ status: "ok" });
      }),
    );

    await send(SERVER, undefined, requestFor("getLive"));

    expect(authorization).toBeNull();
  });

  it("answers no body for a response without one", async () => {
    server.use(
      http.delete(`${SERVER}/api/v1/teams/team_1`, () => new HttpResponse(null, { status: 204 })),
    );

    await expect(send(SERVER, "s", requestFor("deleteTeam", [], ["team_1"]))).resolves.toEqual({
      status: 204,
      body: undefined,
    });
  });

  it("answers text for a response that is not JSON", async () => {
    server.use(http.get(`${SERVER}/api/v1/livez`, () => HttpResponse.text("alive")));

    await expect(send(SERVER, undefined, requestFor("getLive"))).resolves.toMatchObject({
      body: "alive",
    });
  });

  it("escapes what the server wrote before anything prints it", async () => {
    server.use(
      http.get(`${SERVER}/api/v1/teams/team_1`, () =>
        HttpResponse.json({ name: "\u001b[2Jwiped" }),
      ),
    );

    await expect(send(SERVER, "s", requestFor("getTeam", [], ["team_1"]))).resolves.toMatchObject({
      body: { name: "\\x1b[2Jwiped" },
    });
  });

  it("fails a refusal as the error the CLI maps to an exit code, escaped too", async () => {
    server.use(
      http.get(`${SERVER}/api/v1/teams/team_1`, () =>
        HttpResponse.json(
          { code: "team.not_found", message: "no \u001b[31mteam" },
          { status: 404 },
        ),
      ),
    );

    const error = await send(SERVER, "s", requestFor("getTeam", [], ["team_1"])).catch(
      (caught: unknown) => caught,
    );

    expect(toZitadelError(error)).toMatchObject({
      code: "E_NOT_FOUND",
      details: { status: 404, body: { code: "team.not_found", message: "no \\x1b[31mteam" } },
    });
  });
});

describe("sendAll", () => {
  it("follows a cursor the query carries and gathers every page", async () => {
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, ({ request }) => {
        const { items, next } = pageAt(new URL(request.url).searchParams.get("page_token"));
        return HttpResponse.json({ passkeys: items, next_page_token: next });
      }),
    );

    const response = await sendAll(SERVER, "s", requestFor("listUserPasskeys", [], ["user_1"]));

    expect(response.body).toEqual({ passkeys: LETTERS, next_page_token: "" });
  });

  it("follows a cursor the body carries", async () => {
    server.use(
      http.post(`${SERVER}/api/v1/users/query`, async ({ request }) => {
        const body = (await request.json()) as { page_token?: string };
        const { items, next } = pageAt(body.page_token ?? null);
        return HttpResponse.json({ users: items, next_page_token: next });
      }),
    );

    const response = await sendAll(SERVER, "s", requestFor("queryUsers", ["limit=3"]));

    expect(response.body).toEqual({ users: LETTERS, next_page_token: "" });
  });

  it("starts from the page the caller named", async () => {
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
    );

    expect(response.body).toMatchObject({ passkeys: ["d", "e", "f", "g"] });
  });

  it("stops on a server that repeats a cursor", async () => {
    server.use(
      http.get(`${SERVER}/api/v1/users/user_1/passkeys`, () =>
        HttpResponse.json({ passkeys: ["a"], next_page_token: "again" }),
      ),
    );

    await expect(
      sendAll(SERVER, "s", requestFor("listUserPasskeys", [], ["user_1"])),
    ).rejects.toMatchObject({
      message: "The server repeated a page cursor, so --paginate would never finish",
      hint: "Fetch one page at a time with -F limit=<n> and -F page_token=<token>, and report the repeated cursor.",
    });
  });
});
