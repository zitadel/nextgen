/**
 * Console shell smoke test.
 *
 * The console used to host an atom playground (mirrored against the Lit dev
 * server) and this project asserted Lit <-> React parity. That parity gate now
 * lives in Storybook (`@storybook/addon-vitest`, which runs in CI). The console
 * is the real settings app behind an auth guard (Console ADR 0003), so this
 * spec proves the built SPA mounts under its embed base (`/ui/console/`,
 * exercising the `vite preview` base config in `apps/console/vite.config.mts`)
 * and that the guard behaves against a backend-less preview: unauthenticated
 * visits land on the shell-less login screen, deep links carry `?next=`, and
 * with no runtime document the login screen renders the "no project yet"
 * setup hint (Console ADR 0004 §2) instead of the widget.
 */
import { expect, test } from "@playwright/test";

test("unauthenticated console redirects to login under the embed base", async ({ page }) => {
  // The console build is served under `/ui/console/` (it embeds in the Go
  // server), so the app only mounts there — not at the origin root. With no
  // session backend, the `_authed` guard must land on the login route.
  await page.goto("/ui/console/");
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeVisible();

  const url = new URL(page.url());
  expect(url.pathname).toBe("/ui/console/login");
  // Root requests carry no ?next= (kept clean by the guard).
  expect(url.searchParams.get("next")).toBeNull();
});

test("deep links survive the auth guard via ?next=", async ({ page }) => {
  await page.goto("/ui/console/users");
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeVisible();

  const url = new URL(page.url());
  expect(url.pathname).toBe("/ui/console/login");
  expect(url.searchParams.get("next")).toBe("/users");
});
