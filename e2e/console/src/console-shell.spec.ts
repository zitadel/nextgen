/**
 * Console shell smoke test.
 *
 * The console used to host an atom playground (mirrored against the Lit dev
 * server) and this project asserted Lit <-> React parity. That parity gate now
 * lives in Storybook (`@storybook/addon-vitest`, which runs in CI). The console
 * is the real settings app behind an auth guard (Console ADR 0003), so this
 * spec proves the built SPA mounts under its embed base (`/ui/console/`,
 * exercising the `vite preview` base config in `apps/console/vite.config.mts`)
 * and that boot behaves against a backend-less preview.
 *
 * `vite preview` proxies nothing, so every test here stubs
 * `/console/runtime.json` itself — which is the point of the lane after
 * Console ADR 0004 §3: the console tells a server it cannot reach apart from
 * a deployment that has no project yet, and only the second one is the "run
 * `zitadel setup`" hint. Leaving the endpoint unstubbed would exercise the
 * connectivity error, not the guard. (The build under test carries no
 * `VITE_CONSOLE_RUNTIME_FALLBACK`, deliberately: that opt-in is for humans
 * running a backend-less preview, and a lane that set it could no longer see
 * the error state at all.)
 */
import { expect, test, type Page } from "@playwright/test";

const RUNTIME_URL = "**/console/runtime.json";

/** What a reachable server with no project yet answers (ADR 0004 §3, state 2). */
const AWAITING_SETUP = { mode: "standalone" };

async function serveRuntime(page: Page, document: object): Promise<void> {
  await page.route(RUNTIME_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(document),
    }),
  );
}

test("unauthenticated console redirects to login under the embed base", async ({ page }) => {
  // The console build is served under `/ui/console/` (it embeds in the Go
  // server), so the app only mounts there — not at the origin root. With no
  // session backend, the `_authed` guard must land on the login route, where
  // the project-less runtime document renders the setup hint.
  await serveRuntime(page, AWAITING_SETUP);
  await page.goto("/ui/console/");
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeVisible();

  const url = new URL(page.url());
  expect(url.pathname).toBe("/ui/console/login");
  // Root requests carry no ?next= (kept clean by the guard).
  expect(url.searchParams.get("next")).toBeNull();
});

test("deep links survive the auth guard via ?next=", async ({ page }) => {
  await serveRuntime(page, AWAITING_SETUP);
  await page.goto("/ui/console/users");
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeVisible();

  const url = new URL(page.url());
  expect(url.pathname).toBe("/ui/console/login");
  expect(url.searchParams.get("next")).toBe("/users");
});

test("an erroring runtime endpoint renders a retryable connectivity error", async ({ page }) => {
  // The failure this replaces: a 500 used to render "No project yet", sending
  // an operator to `zitadel setup` for a server outage (Console ADR 0004 §3).
  let broken = true;
  await page.route(RUNTIME_URL, (route) =>
    broken
      ? route.fulfill({ status: 500, contentType: "application/json", body: `{"error":"boom"}` })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(AWAITING_SETUP),
        }),
  );

  await page.goto("/ui/console/");
  await expect(page.getByRole("heading", { name: "Server unavailable" })).toBeVisible();
  await expect(page.getByText("the server answered 500")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeHidden();
  // The router never mounted, so no guard redirect happened either.
  expect(new URL(page.url()).pathname).toBe("/ui/console/");

  // Retry is a real second attempt, not a reload hint: recovering the server
  // hands the operator the console on one click.
  broken = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/ui/console/login");
});

test("an unreachable runtime endpoint renders the same connectivity error", async ({ page }) => {
  await page.route(RUNTIME_URL, (route) => route.abort("failed"));

  await page.goto("/ui/console/");
  await expect(page.getByRole("heading", { name: "Server unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeHidden();
});
