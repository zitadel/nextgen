import type { ConnectedZitadel } from "@zitadel/testing";
import { afterEach, describe, expect, test, vi } from "vitest";

import { Credentials } from "./credentials";
import { OpenApiSpec } from "./spec";

const spec = new OpenApiSpec({
  components: {
    securitySchemes: {
      oauth2: { type: "oauth2" },
      sessionCookie: { type: "apiKey", in: "cookie" },
    },
  },
  paths: {},
});

function zitadel(): ConnectedZitadel {
  return {
    handle: { projectSecret: "secret" },
    seedSession: vi.fn().mockResolvedValue({ cookie: { value: "cookie-value" } }),
  } as unknown as ConnectedZitadel;
}

function credentials(connected: ConnectedZitadel = zitadel()): Credentials {
  return new Credentials(connected, spec, "http://x/api/v1");
}

function csrf(status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response(JSON.stringify({ csrf_token: "token" }), { status }));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Credentials", () => {
  test("sends nothing to the public operations", async () => {
    await expect(credentials().forFamily("public")).resolves.toEqual({ headers: {}, schemes: {} });
  });

  test("gives the management operations the project secret for the bearer scheme", async () => {
    await expect(credentials().forFamily("management")).resolves.toEqual({
      headers: {},
      schemes: { oauth2: { kind: "bearer", value: "secret" } },
    });
  });

  test.each(["session", "logout"] as const)(
    "gives the %s operations the session cookie for the cookie scheme and its CSRF token",
    async (family) => {
      csrf();

      await expect(credentials().forFamily(family)).resolves.toEqual({
        headers: { "X-Zitadel-CSRF": "token" },
        schemes: { sessionCookie: { kind: "cookie", value: "cookie-value" } },
      });
    },
  );

  test("asks for the CSRF token with the session cookie", async () => {
    csrf();

    await credentials().forFamily("session");

    expect(fetch).toHaveBeenCalledWith("http://x/api/v1/sessions/me/csrf", {
      headers: { Cookie: "__Host-zitadel_session=cookie-value" },
    });
  });

  test("mints a session of its own for each session family", async () => {
    csrf();
    const connected = zitadel();
    const subject = credentials(connected);

    await subject.forFamily("session");
    await subject.forFamily("logout");

    expect(connected.seedSession).toHaveBeenCalledTimes(2);
  });

  test("fails when the server will not issue a CSRF token", async () => {
    csrf(401);

    await expect(credentials().forFamily("session")).rejects.toThrow("answered 401");
  });
});
