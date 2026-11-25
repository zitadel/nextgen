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
  test("gives the project secret for the bearer scheme", () => {
    expect(credentials().bearer()).toEqual({ oauth2: { kind: "bearer", value: "secret" } });
  });

  test("gives a session the cookie for the cookie scheme and its CSRF token", async () => {
    csrf();

    await expect(credentials().session()).resolves.toEqual({
      scheme: { sessionCookie: { kind: "cookie", value: "cookie-value" } },
      csrfToken: "token",
    });
  });

  test("asks for the CSRF token with the session cookie", async () => {
    csrf();

    await credentials().session();

    expect(fetch).toHaveBeenCalledWith("http://x/api/v1/sessions/me/csrf", {
      headers: { Cookie: "__Host-zitadel_session=cookie-value" },
    });
  });

  test("mints a session of its own on every call", async () => {
    csrf();
    const connected = zitadel();
    const subject = credentials(connected);

    await subject.session();
    await subject.session();

    expect(connected.seedSession).toHaveBeenCalledTimes(2);
  });

  test("fails when the server will not issue a CSRF token", async () => {
    csrf(401);

    await expect(credentials().session()).rejects.toThrow("answered 401");
  });
});
