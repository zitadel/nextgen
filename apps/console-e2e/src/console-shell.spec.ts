/**
 * Console shell smoke test.
 *
 * The console used to host an atom playground (mirrored against the Lit dev
 * server) and this project asserted Lit <-> React parity. That parity gate now
 * lives in Storybook (`@storybook/addon-vitest`, which runs in CI). The console
 * is becoming the real settings app, so this spec just proves the built SPA
 * mounts under its embed base (`/ui/console/`) and exercises the `vite preview`
 * base config in `apps/console/vite.config.mts`.
 */
import { expect, test } from "@playwright/test";

test("console shell mounts under the embed base", async ({ page }) => {
  // The console build is served under `/ui/console/` (it embeds in the Go
  // server), so the app only mounts there — not at the origin root.
  await page.goto("/ui/console/");
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
});
