import { expect, test } from "@playwright/test";

/**
 * The one browser check: the built site hydrates and navigates. Everything
 * else the suite proves over HTTP.
 */
test("a page renders, navigates client-side and logs no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The local build cannot serve Vercel's analytics scripts (/_vercel/).
    if (message.type() === "error" && !message.location().url.includes("/_vercel/")) {
      errors.push(message.text());
    }
  });

  await page.goto("/docs/get-started/quickstart");
  await expect(page.getByRole("heading", { level: 1, name: "Quickstart" })).toBeVisible();

  // The sidebar is the page tree; following it is a client-side navigation.
  await page.getByRole("link", { name: "Agent setup" }).first().click();
  await expect(page).toHaveURL(/\/docs\/get-started\/agents$/);
  await expect(page.getByRole("heading", { level: 1, name: "Agent setup" })).toBeVisible();

  expect(errors).toEqual([]);
});
