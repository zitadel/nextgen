/**
 * The server middleware contract (`@zitadel/server-sdk-contract/middleware`)
 * for Nuxt: this file is the glue between its cases and this SDK's handler.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { EventHandler, H3Event, H3EventContext } from "h3";

import { createApp, toWebHandler } from "h3";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { ZitadelAuthResult } from "@zitadel/sdk-core/middleware";
import type { Served, ServeInit, ServeOptions } from "@zitadel/server-sdk-contract/middleware";

import { describeServerMiddleware } from "@zitadel/server-sdk-contract/middleware";

import { createZitadelMiddleware, getAuth } from "../../runtime/server/middleware";
import { setRuntimeConfig } from "../stubs/nuxt-imports";

// Each case starts from an app that sets no runtime config.
beforeEach(() => {
  setRuntimeConfig({ zitadel: {} });
});

async function serve(
  url: string,
  init: ServeInit = {},
  options: ServeOptions = {},
): Promise<Served> {
  const app = createApp();
  if (init.clientIp) {
    app.use((event) => {
      (event.node.req as unknown as { socket: { remoteAddress?: string } }).socket = {
        remoteAddress: init.clientIp,
      };
    });
  }
  app.use(createZitadelMiddleware(options));
  let continued = false;
  let auth: ZitadelAuthResult | undefined;
  app.use((event) => {
    continued = true;
    auth = event.context.zitadelAuth;
    return { ok: true };
  });
  const response = await toWebHandler(app)(
    new Request(url, {
      method: init.method ?? "GET",
      headers: { host: new URL(url).host, ...init.headers },
    }),
  );
  return {
    answered: !continued,
    status: response.status,
    headers: response.headers,
    auth,
    body: await response.text(),
  };
}

function configureSecret(configured?: string, environment?: string): ServeOptions {
  setRuntimeConfig({ zitadel: { projectSecret: configured } });
  vi.stubEnv("ZITADEL_PROJECT_SECRET", environment);
  return {};
}

function configureProject(configured?: string, environment?: string): ServeOptions {
  vi.stubEnv("ZITADEL_PROJECT_ID", environment);
  vi.stubEnv("NUXT_PUBLIC_ZITADEL_PROJECT_ID", undefined);
  return { projectId: configured };
}

async function readAuth(context: unknown): Promise<ZitadelAuthResult> {
  return getAuth({ context: context ?? {} } as unknown as H3Event);
}

function expectHandlerType(): void {
  expectTypeOf(createZitadelMiddleware({ url: "http://localhost:4000" })).toExtend<EventHandler>();
  expectTypeOf<H3EventContext["zitadelAuth"]>().toEqualTypeOf<ZitadelAuthResult | undefined>();
}

describeServerMiddleware({
  serve,
  configureSecret,
  configureProject,
  readAuth,
  expectHandlerType,
  checksSessionsOnPublicRoutes: true,
});

describe("protected routes and encoded paths", () => {
  const options = {
    url: "http://localhost:4000",
    projectId: "project",
    protectedRoutes: ["/admin*"],
    loginPath: "/login",
  };

  it.each(["/admin", "/%61dmin", "/ad%6Din/x"])(
    "sends a signed-out visitor of %s to the login page",
    async (path) => {
      const served = await serve(`http://localhost:3000${path}`, {}, options);

      expect(served.status).toBe(302);
      expect(served.headers.get("location")).toContain("/login");
    },
  );
});

describe("an empty backend URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("counts as unset, so the proxy uses the next source", async () => {
    const requested: string[] = [];
    const backend = createServer((request, response) => {
      requested.push(request.url ?? "");
      response.end("{}");
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;
    vi.stubEnv("ZITADEL_URL", `http://127.0.0.1:${port}`);

    try {
      await serve("http://localhost:3000/__nextgen/ping", {}, { url: "" });
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(requested).toEqual(["/ping"]);
  });
});

describe("an empty project secret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["", "", undefined],
    ["", "from-env", "Bearer from-env"],
    ["from-option", "from-env", "Bearer from-option"],
  ])("with option %j and environment %j sends %s", async (option, environment, expected) => {
    let authorization: string | undefined;
    let requested = false;
    const backend = createServer((request, response) => {
      requested = true;
      authorization = request.headers.authorization;
      response.end("{}");
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;
    vi.stubEnv("ZITADEL_PROJECT_SECRET", environment);

    try {
      await serve(
        "http://localhost:3000/__nextgen/api/v1/sessions/exchange",
        { method: "POST" },
        { url: `http://127.0.0.1:${port}`, projectSecret: option },
      );
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(requested).toBe(true);
    expect(authorization).toBe(expected);
  });
});

describe("proxied OAuth paths of another project", () => {
  it.each([
    "/__nextgen/.well-known/oauth-authorization-server/oauth/other",
    "/__nextgen/.well-known/openid-configuration/oauth/other",
    "/__nextgen/%6Fauth/other/authorize",
    "/__nextgen/oauth%2Fother",
  ])("answers 404 for %s", async (path) => {
    const served = await serve(
      `http://localhost:3000${path}`,
      {},
      { url: "http://localhost:4000", projectId: "project" },
    );

    expect(served.status).toBe(404);
  });

  it("forwards the issuer of its own project to the backend", async () => {
    const requested: string[] = [];
    const backend = createServer((request, response) => {
      requested.push(request.url ?? "");
      response.end("{}");
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;

    try {
      await serve(
        "http://localhost:3000/__nextgen/oauth/project/x",
        {},
        { url: `http://127.0.0.1:${port}`, projectId: "project" },
      );
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(requested).toEqual(["/oauth/project/x"]);
  });
});

describe("an unsafe login path", () => {
  it.each(["//evil.com", "https://evil.com", "/\\evil.com"])("throws for %s", async (loginPath) => {
    await expect(
      serve("http://localhost:3000/admin", {}, { projectId: "project", loginPath }),
    ).rejects.toThrow(/loginPath must be a relative path/);
  });

  it("accepts /login", async () => {
    const served = await serve(
      "http://localhost:3000/admin",
      {},
      { projectId: "project", protectedRoutes: ["/admin"], loginPath: "/login" },
    );

    expect(served.status).toBe(302);
  });
});

describe("a cleared session cookie", () => {
  it("carries Max-Age=0 and Secure over https", async () => {
    const backend = createServer((_request, response) => {
      response.statusCode = 401;
      response.end();
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;
    let cleared: string | undefined;

    try {
      const served = await serve(
        "https://localhost:3000/admin",
        {
          headers: {
            cookie: "__Host-zitadel_session_project=dead",
            "x-forwarded-proto": "https",
          },
        },
        { url: `http://127.0.0.1:${port}`, projectId: "project", protectedRoutes: ["/admin"] },
      );
      cleared = served.headers.getSetCookie()[0];
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(cleared).toMatch(/^__Host-zitadel_session_project=;/);
    expect(cleared).toMatch(/; Max-Age=0(;|$)/i);
    expect(cleared).toMatch(/; Secure(;|$)/i);
  });
});

describe("a request with the internal auth header", () => {
  it("is refused with a plain text 400", async () => {
    const served = await serve("http://localhost:3000/", {
      headers: { "x-zitadel-auth-token": "forged" },
    });

    expect(served.status).toBe(400);
    expect(served.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(served.body).toBe("Bad Request");
  });
});

describe("proxied request headers", () => {
  it("reach the backend with the empty ones, without the hop-by-hop ones", async () => {
    let received: Record<string, string | string[] | undefined> = {};
    const backend = createServer((request, response) => {
      received = request.headers;
      response.end("{}");
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;

    try {
      await serve(
        "http://localhost:3000/__nextgen/ping",
        { headers: { "x-custom": "kept", "x-empty": "", "keep-alive": "timeout=5" } },
        { url: `http://127.0.0.1:${port}` },
      );
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(received["x-custom"]).toBe("kept");
    expect(received["x-empty"]).toBe("");
    expect(received["keep-alive"]).toBeUndefined();
  });
});

describe("proxied requests without a body", () => {
  it("reach the backend as a POST with no body", async () => {
    const received: { method?: string; body: string }[] = [];
    const backend = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ method: request.method, body: Buffer.concat(chunks).toString() });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;
    let status = 0;

    try {
      const served = await serve(
        "http://localhost:3000/__nextgen/ping",
        { method: "POST" },
        { url: `http://127.0.0.1:${port}` },
      );
      status = served.status;
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(status).toBe(200);
    expect(received).toEqual([{ method: "POST", body: "" }]);
  });
});

describe("a proxied redirect", () => {
  it("keeps a path that starts with two slashes on the origin of the request", async () => {
    const backend = createServer((_request, response) => {
      const { port } = backend.address() as AddressInfo;
      response.writeHead(302, { location: `http://127.0.0.1:${port}//evil.example/x?a=1` });
      response.end();
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const { port } = backend.address() as AddressInfo;
    let status = 0;
    let location: string | null = null;

    try {
      const served = await serve(
        "http://localhost:3000/__nextgen/ping",
        {},
        { url: `http://127.0.0.1:${port}` },
      );
      status = served.status;
      location = served.headers.get("location");
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }

    expect(status).toBe(302);
    expect(location).toBe("http://localhost:3000/evil.example/x?a=1");
  });
});

describe("a login redirect", () => {
  it("is an absolute URL on the origin of the request and carries the requested path", async () => {
    const served = await serve(
      "http://localhost:3000/admin/users?tab=open",
      {},
      {
        url: "http://localhost:4000",
        projectId: "project",
        protectedRoutes: ["/admin*"],
        loginPath: "/login",
      },
    );

    expect(served.status).toBe(302);
    expect(served.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fadmin%2Fusers%3Ftab%3Dopen",
    );
  });
});
