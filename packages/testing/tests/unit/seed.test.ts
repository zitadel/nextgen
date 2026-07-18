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
