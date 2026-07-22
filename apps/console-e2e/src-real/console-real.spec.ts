import type { Page } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

const ERROR_HEADINGS = ["Not authorized", "Something went wrong"];

test.describe.configure({ mode: "parallel" });

test("shows the bootstrapped project", async ({ page, zitadel }) => {
  await page.goto("/projects");

  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByText(zitadel.handle.projectId, { exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("shows a seeded user in the list and detail views", async ({ page, seed }) => {
  const user = await seed.user();

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();

  const userLink = page.getByRole("link", { name: user.email, exact: true });
  await expect(userLink).toBeVisible();
  await userLink.click();

  await expect(page).toHaveURL(new RegExp(`/users/${user.id}$`));
  await expect(page.getByRole("heading", { name: user.email, exact: true })).toBeVisible();
  await expect(page.getByText(user.id, { exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("keeps the project credential out of browser requests and resources", async ({
  page,
  zitadel,
}) => {
  const inspectedResponses: Array<Promise<string | undefined>> = [];
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    const textual =
      contentType.includes("html") ||
      contentType.includes("css") ||
      contentType.includes("javascript") ||
      contentType.includes("json");
    if (!textual) return;

    inspectedResponses.push(
      response
        .text()
        .then((body) => (body.includes(zitadel.handle.projectSecret) ? response.url() : undefined))
        .catch(() => undefined),
    );
  });

  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.startsWith("/api/projects/");
  });

  await page.goto("/projects");
  const response = await responsePromise;

  expect(response.request().headers().authorization).toBeUndefined();
  expect(response.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

  const leakedResources = (await Promise.all(inspectedResponses)).filter(
    (url): url is string => url !== undefined,
  );
  expect(leakedResources).toEqual([]);
  expect((await page.content()).includes(zitadel.handle.projectSecret)).toBe(false);
});

async function expectNoErrorBoundary(page: Page): Promise<void> {
  for (const heading of ERROR_HEADINGS) {
    await expect(page.getByText(heading, { exact: true })).toHaveCount(0);
  }
}
