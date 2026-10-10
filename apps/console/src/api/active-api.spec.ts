import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

/**
 * Platform mode's client routing (Console ADR 0004 §6): `api` follows the
 * active region the `_authed` guard sets, `homeApi` never leaves the home, and
 * a region's path base sits below the console's own base so the same cookie
 * reaches it.
 */
describe("api in platform mode", () => {
  it("follows the active region, while homeApi stays at the home", async () => {
    const { api, homeApi, setActiveApi } = await import("./zitadel");
    const seen: string[] = [];
    server.use(
      http.get("http://localhost/api/*", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({ projects: [] });
      }),
    );

    await api.listMyProjects();
    setActiveApi({ api_base: "/eu" });
    await api.listMyProjects();
    await homeApi.listMyProjects();
    setActiveApi(undefined);
    await api.listMyProjects();

    expect(seen).toEqual([
      "/api/users/me/projects",
      "/api/eu/users/me/projects",
      "/api/users/me/projects",
      "/api/users/me/projects",
    ]);
  });

  it("joins a region's path with the console's base and keeps an absolute one", async () => {
    const { resolveRegionBase } = await import("./zitadel");
    expect(resolveRegionBase("/eu")).toBe("http://localhost/api/eu");
    expect(resolveRegionBase("https://us.example")).toBe("https://us.example");
  });
});
