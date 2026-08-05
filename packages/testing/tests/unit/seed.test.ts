import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { connectZitadel } from "../../src/index";
import type { InstanceHandle } from "../../src/types";

const BASE = "http://zitadel-testing.invalid";

const handle: InstanceHandle = {
  baseUrl: BASE,
  projectId: "proj_1",
  projectSecret: "secret_1",
  schemaId: "sch_1",
};

interface Captured {
  userBody?: Record<string, unknown>;
  userAuth?: string | null;
  userQuery?: string;
  passwordBody?: Record<string, unknown>;
  passwordUserId?: string;
}

const captured: Captured = {};

const server = setupServer(
  http.post(`${BASE}/users`, async ({ request }) => {
    captured.userBody = (await request.json()) as Record<string, unknown>;
    captured.userAuth = request.headers.get("authorization");
    captured.userQuery = new URL(request.url).searchParams.get("project_id") ?? "";
    return HttpResponse.json({ id: "user_1" }, { status: 201 });
  }),
  http.put(`${BASE}/users/:userId/password`, async ({ request, params }) => {
    captured.passwordBody = (await request.json()) as Record<string, unknown>;
    captured.passwordUserId = params.userId as string;
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  for (const key of Object.keys(captured) as (keyof Captured)[]) {
    delete captured[key];
  }
});
afterAll(() => server.close());

describe("seedUser via connectZitadel", () => {
  it("creates the user against the schema and sets an immediately-usable password", async () => {
    const zitadel = connectZitadel(handle);
    const user = await zitadel.seedUser();

    expect(user.id).toBe("user_1");
    expect(user.email).toMatch(/^e2e-[0-9a-f]{8}@example\.com$/);
    expect(user.password.length).toBeGreaterThanOrEqual(8);

    expect(captured.userBody).toMatchObject({ $schema: "sch_1", email: user.email });
    expect(captured.userAuth).toBe("Bearer secret_1");
    expect(captured.userQuery).toBe("proj_1");
    expect(captured.passwordUserId).toBe("user_1");
    expect(captured.passwordBody).toEqual({ password: user.password, isChangeRequired: false });
  });

  it("honors explicit email, password, and extra attributes", async () => {
    const zitadel = connectZitadel(handle);
    const user = await zitadel.seedUser({
      email: "alice@acme.com",
      password: "hunter2-hunter2",
      attributes: { firstName: "Alice" },
    });

    expect(user).toEqual({
      id: "user_1",
      email: "alice@acme.com",
      password: "hunter2-hunter2",
    });
    expect(captured.userBody).toMatchObject({
      $schema: "sch_1",
      email: "alice@acme.com",
      firstName: "Alice",
    });
  });

  it("never lets attributes override reserved fields", async () => {
    const zitadel = connectZitadel(handle);
    const user = await zitadel.seedUser({
      email: "real@acme.com",
      attributes: { email: "evil@acme.com", $schema: "sch_evil", firstName: "Mallory" },
    });

    expect(user.email).toBe("real@acme.com");
    expect(captured.userBody).toMatchObject({
      $schema: "sch_1",
      email: "real@acme.com",
      firstName: "Mallory",
    });
  });

  it("propagates unique-email conflicts", async () => {
    server.use(
      http.post(`${BASE}/users`, () =>
        HttpResponse.json({ code: "user.exists", message: "duplicate" }, { status: 409 }),
      ),
    );
    const zitadel = connectZitadel(handle);
    await expect(zitadel.seedUser({ email: "dup@acme.com" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("exposes the app env for SDK apps", () => {
    const zitadel = connectZitadel(handle);
    expect(zitadel.appEnv).toEqual({
      ZITADEL_URL: BASE,
      NEXT_PUBLIC_ZITADEL_PROJECT_ID: "proj_1",
      ZITADEL_PROJECT_SECRET: "secret_1",
    });
  });
});

describe("seed vocabulary", () => {
  it("identity() mints unique unused credentials and touches no API", () => {
    const zitadel = connectZitadel(handle);
    const one = zitadel.identity();
    const two = zitadel.identity();
    expect(one.email).toMatch(/^e2e-[0-9a-f]{8}@example\.com$/);
    expect(one.email).not.toBe(two.email);
    expect(one.password).not.toBe(two.password);
    // onUnhandledRequest: "error" would fail this test if anything was called.
  });

  it("seedUsers applies the per-index template and keeps unique defaults", async () => {
    let nextId = 0;
    server.use(
      http.post(`${BASE}/users`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        nextId += 1;
        return HttpResponse.json({ id: `user_${nextId}`, echo: body }, { status: 201 });
      }),
    );
    const zitadel = connectZitadel(handle);
    const users = await zitadel.seedUsers(3, {
      email: (index) => `fixture-${index}@example.com`,
      attributes: (index) => ({ givenName: `User${index}` }),
    });

    expect(users.map((user) => user.id)).toEqual(["user_1", "user_2", "user_3"]);
    expect(users.map((user) => user.email)).toEqual([
      "fixture-0@example.com",
      "fixture-1@example.com",
      "fixture-2@example.com",
    ]);
    // Untemplated passwords stay unique per user.
    expect(new Set(users.map((user) => user.password)).size).toBe(3);
  });
});
