import type { Page } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

const ERROR_HEADINGS = ["Not authorized", "Something went wrong"];

test.describe.configure({ mode: "parallel" });

/**
 * Completes the console's login screen (Console ADR 0003) with a seeded
 * user: the default-login flow's identifier step ("Work email" + "Sign in"),
 * then the password step ("Password" + "Sign in"). The widget exchanges the
 * handoff for the `__nextgen_session` cookie and performs a full-document
 * navigation away from /login.
 */
async function signIn(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
}

test("shows the bootstrapped project", async ({ page, zitadel, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/projects");

  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByText(zitadel.handle.projectId, { exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("shows a seeded user in the list and detail views", async ({ page, seed }) => {
  const user = await seed.user();
  await signIn(page, user);

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
  seed,
}) => {
  // Sign in first (Console ADR 0003): the resource pages sit behind the auth
  // guard, and the login exchange itself must not leak the project secret
  // either — the listener below starts before any navigation under test.
  await signIn(page, await seed.user());

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
