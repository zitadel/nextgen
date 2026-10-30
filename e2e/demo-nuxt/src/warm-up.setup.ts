import { test as setup } from "@playwright/test";

/**
 * Loads `/login` once before the specs, which depend on this project.
 * `nuxt dev` builds each browser module when a browser first asks for it, so
 * the first load walks the app's imports level by level, and waits while Vite
 * pre-bundles the widget's dependencies (lit and the rest) it found on the
 * way. The webServer check only renders `/login` on the server, which loads
 * none of them. On a loaded runner (a GitHub-hosted one running every lane at
 * once) that first load outlasts a spec's 5 s `expect`, so it is paid here,
 * where only the test timeout bounds it.
 */
setup("loads the login widget once", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue", exact: true }).waitFor({ timeout: 0 });
});
