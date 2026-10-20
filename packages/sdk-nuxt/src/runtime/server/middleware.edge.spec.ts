import { createApp, toWebHandler } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setRuntimeConfig } from "../../__tests__/stubs/nuxt-imports";
import { createNextgenMiddleware } from "./middleware";

const ORIGIN = "http://localhost:3000";
const BACKEND = "http://localhost:4000";

/**
 * Serves `request` through the middleware inside the `edge-runtime` VM (the
 * `edge` project in `vitest.config.ts`), which has no `node:` modules
 * and no socket. h3's web handler builds the event the way Nitro's edge
 * presets do, over a web `Request`; the middleware reaches the request only
 * through h3's accessors, so it runs here as it does on Node.
 */
async function serve(request: Request, context: Record<string, string> = {}): Promise<Response> {
  setRuntimeConfig({ nextgen: {} });
  const app = createApp();
  app.use(
    createNextgenMiddleware({ url: BACKEND, projectId: "proj_app", protectedRoutes: ["/admin*"] }),
  );
  app.use(() => ({ ok: true }));
  return toWebHandler(app)(request, context);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server middleware in the edge runtime", () => {
  it("lets a public route through", async () => {
    const response = await serve(new Request(`${ORIGIN}/`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("redirects a protected route to the login page", async () => {
    const response = await serve(new Request(`${ORIGIN}/admin`));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login");
    expect(response.headers.get("location")).toContain("next=%2Fadmin");
  });

  it("refuses a request carrying the internal auth header", async () => {
    const response = await serve(
      new Request(`${ORIGIN}/`, { headers: { "x-nextgen-auth-token": "forged" } }),
    );

    expect(response.status).toBe(400);
  });

  it("proxies to the backend with its status, headers and cookies", async () => {
    const calls: { url: string; headers: Headers; body: BodyInit | null | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: new Headers(init.headers), body: init.body });
        return new Response("created", {
          status: 201,
          headers: [
            ["x-upstream", "yes"],
            ["set-cookie", "a=1; Path=/"],
            ["set-cookie", "b=2; Path=/"],
          ],
        });
      }),
    );

    const response = await serve(
      new Request(`${ORIGIN}/__nextgen/flows?x=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"a":1}',
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("created");
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BACKEND}/flows?x=1`);
    expect(calls[0]?.headers.get("x-forwarded-for")).toBeNull();
    expect(await new Response(calls[0]?.body).text()).toBe('{"a":1}');
  });

  it("appends the address the runtime reports to the forwarded chain", async () => {
    const calls: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(new Headers(init.headers));
        return new Response(null, { status: 204 });
      }),
    );

    await serve(
      new Request(`${ORIGIN}/__nextgen/flows`, { headers: { "x-forwarded-for": "198.51.100.7" } }),
      { clientAddress: "203.0.113.9" },
    );

    expect(calls[0]?.get("x-forwarded-for")).toBe("198.51.100.7, 203.0.113.9");
  });
});
