import { HttpResponse, http } from "msw";
import { describe, expect } from "vitest";

import { it } from "../../../helpers/fixtures";

import { send, sendAll } from "../../../../src/lib/raw-api/call";
import { resolveTarget } from "../../../../src/lib/raw-api/operations";
import { buildRequest, pathValuesOf, withPathValues } from "../../../../src/lib/raw-api/request";
import { forcedConsent } from "../../../helpers/consent";
import { toZitadelError } from "../../../../src/lib/errors";

const signal = new AbortController().signal;

const SERVER = "http://localhost:8080";

const requestFor = (ref: string, fields: string[] = [], positionals: string[] = []) => {
  const target = resolveTarget(ref);
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

describe("send", () => {
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
      send(SERVER, "s", requestFor("deleteTeam", [], ["team_1"]), signal, await forcedConsent()),
    ).resolves.toEqual({
      status: 204,
      body: undefined,
    });
  });

  it("refuses a destructive operation without consent", async () => {
    await expect(
      send(SERVER, "s", requestFor("deleteTeam", [], ["team_1"]), signal),
    ).rejects.toThrow("A destructive operation ran without consent");
  });

  it("sends nothing for a destructive operation without consent", async ({ server }) => {
    const sent: string[] = [];
    server.use(
      http.delete(`${SERVER}/api/v1/teams/team_1`, ({ request }) => {
        sent.push(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await send(SERVER, "s", requestFor("deleteTeam", [], ["team_1"]), signal).catch(
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
      send(SERVER, "s", requestFor("updateVariables", ["FOO:=null", "project_id=proj_1"]), signal),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("answers text for a response that is not JSON", async ({ server }) => {
    server.use(http.get(`${SERVER}/api/v1/livez`, () => HttpResponse.text("alive")));

    await expect(send(SERVER, undefined, requestFor("getLive"), signal)).resolves.toMatchObject({
      body: "alive",
    });
  });

  it("escapes what the server wrote before anything prints it", async ({ server }) => {
    server.use(
      http.get(`${SERVER}/api/v1/teams/team_1`, () =>
        HttpResponse.json({ name: "\u001b[2Jwiped" }),
      ),
    );

    await expect(
      send(SERVER, "s", requestFor("getTeam", [], ["team_1"]), signal),
    ).resolves.toMatchObject({
      body: { name: "\\x1b[2Jwiped" },
    });
  });

  it("fails a refusal as the error the CLI maps to an exit code, escaped too", async ({
    server,
  }) => {
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
      details: { status: 404, body: { code: "team.not_found", message: "no \\x1b[31mteam" } },
    });
  });
});

describe("sendAll", () => {
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
      code: "E_VALIDATION",
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

  it("sends a cursor back as the server wrote it, and escapes the items", async ({ server }) => {
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
      { passkeys: ["\\x1b[2Ja", "b"], next_page_token: "" },
    ]);
  });

  it("answers the last page's other fields escaped once, its items in their place", async ({
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
      JSON.stringify({ note: "\\x1b[2J", passkeys: ["a"], next_page_token: "" }),
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
