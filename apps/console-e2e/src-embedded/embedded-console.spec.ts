import { expect, test } from "@zitadel/testing/playwright";

/**
 * The console as the Go binary serves it (Console ADR 0002 §4).
 *
 * Everything here is ordinary console behaviour that the other two suites
 * already appear to cover. The difference is the server: this one is the
 * built binary, serving the SPA out of `internal/staticui/console` and the
 * ogen API at the origin root, with no proxy in between. That makes the
 * console's API base a real claim about a real routing table instead of a
 * string nobody checks — the claim that shipped wrong, as `/api/*` against a
 * mux that serves `/ui/login`, `/ui/console`, `/console/runtime.json`, `/`.
 *
 * Keep the assertions here about *reaching the API*. Console features belong
 * in `src-real/`, which runs the same screens with the dev proxy's project
 * secret and can therefore exercise the management calls this lane cannot.
 */

test("signs in end to end against the embedded API", async ({ page, seed }) => {
  const user = await seed.user();

  await page.goto("/ui/console/");

  // The guard's `GET /sessions/me` has to reach the API to answer 401; a
  // request to a path the mux does not serve produces the same redirect (
  // `fetchSession` swallows every failure), so the redirect alone proves
  // nothing. The widget below is what needs a live API.
  await expect(page).toHaveURL(/\/ui\/console\/login$/);

  // `POST /flow` — the first call whose result is visible on screen. With the
  // wrong base the widget renders "POST /api/flow returned 404" here.
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByLabel("Password")).toBeVisible();
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Terminal step → `POST /sessions/exchange` with the runtime-discovered
  // publishable key → `__nextgen_session` cookie → full-document navigation
  // back into the console, where the guard's `GET /sessions/me` now answers
  // 200. Four more calls that only resolve if the base is right.
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  await expect(page).toHaveURL(/\/ui\/console\/$/);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
});

test("targets the origin root, never an /api prefix", async ({ page }) => {
  const apiPrefixed: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      apiPrefixed.push(`${request.method()} ${pathname}`);
    }
  });

  await page.goto("/ui/console/");
  await expect(page.getByLabel("Email")).toBeVisible();

  // The dev proxy's path, and the only base the binary has never served.
  // Asserted on the request side so the failure names what was called rather
  // than leaving a rendered 404 to be interpreted.
  expect(apiPrefixed).toEqual([]);
});

test("serves the runtime document the console bootstraps from", async ({ page, zitadel }) => {
  const response = await page.request.get("/console/runtime.json");
  expect(response.status()).toBe(200);

  // Mounted at a root path, independent of where the SPA lives, and naming
  // the deployment's own project — the one the widget above signed into.
  await expect(response.json()).resolves.toMatchObject({
    mode: "standalone",
    console_project_id: zitadel.handle.projectId,
  });
});
