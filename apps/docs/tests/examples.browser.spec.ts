import { expect, type Page, test } from "@playwright/test";

import { recordPolicyViolations } from "./support";

/**
 * The live examples (components/examples): their atoms render, and each
 * page's <zitadel-login> runs against the mock in the browser, whose service
 * worker stays inside /docs/. What an atom or the login does is
 * packages/components' to prove; this proves that the examples' scripts and
 * the worker reach the browser, from the local build and from a deployment.
 */

/** The page's errors, as site.browser.spec.ts collects them. */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The local build cannot serve Vercel's analytics scripts (/_vercel/).
    if (message.type() === "error" && !message.location().url.includes("/_vercel/")) {
      errors.push(message.text());
    }
  });
  return errors;
}

test("the components page walks a sign-in over the mock, inside /docs/", async ({ page }) => {
  const errors = collectErrors(page);
  // The worker and the login run under the page's policies too.
  const violations = await recordPolicyViolations(page);
  // Every call the login makes is the mock's to answer; one that reached the
  // network would be on its way to a server.
  const unmocked: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/docs/mock-api/")) {
      if (!response.fromServiceWorker()) unmocked.push(response.url());
    }
  });

  await page.goto("/docs/sdks/components");
  const login = page.locator("zitadel-login");
  await login.getByRole("textbox", { name: /^Email/ }).fill("ada@example.com");
  await login.getByRole("button", { name: "Continue" }).click();
  await expect(login.getByText("Enter your password")).toBeVisible();

  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.scope,
  );
  expect(scope).toBe(new URL("/docs/", page.url()).href);
  expect(unmocked).toEqual([]);
  expect(errors).toEqual([]);
  expect(violations, "policy violations").toEqual([]);
});

test("the components page renders its atoms", async ({ page }) => {
  await page.goto("/docs/sdks/components");
  // The examples' own atoms, outside the login's shadow root: each has
  // rendered into its own.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll("zl-button, zl-field, zl-alert, zl-checkbox, zl-pill")]
          .filter((atom) => (atom.shadowRoot?.childElementCount ?? 0) > 0)
          .map((atom) => atom.localName),
      ),
    )
    .toEqual(["zl-button", "zl-field", "zl-alert", "zl-checkbox", "zl-pill"]);
});

test("the design guide's login wears the stylesheet it shows", async ({ page }) => {
  await page.goto("/docs/guides/customize-design");
  const button = page.locator("zitadel-login").getByRole("button", { name: /continue/i });
  // A token and a part from the guide's stylesheet (components/examples/flat-look.ts).
  await expect(button).toHaveCSS("background-color", "rgb(10, 10, 10)");
  await expect(button).toHaveCSS("text-transform", "uppercase");
});

test("the text guide's login shows the title its locales set", async ({ page }) => {
  await page.goto("/docs/guides/customize-copy");
  await expect(page.locator("zitadel-login").getByText("Welcome back")).toBeVisible();
});
