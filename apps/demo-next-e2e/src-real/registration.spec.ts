import type { Locator, Page } from "@playwright/test";

import { expect, test } from "@zitadel/testing/playwright";

/**
 * Registration through the real flow with a kit-minted unused identity:
 * `seed.identity()` creates nothing, so the flow itself must create the user —
 * verified through the API afterwards. Locators follow the journey suite's
 * resilient pattern (testid first, role fallback) because registration spans
 * more steps than login.
 */
test("a fresh identity registers through the real flow", async ({ page, seed, zitadel }) => {
  const who = seed.identity();

  await page.goto("/login");
  await page.getByLabel(/email/i).fill(who.email);
  // Submitting an unknown identifier routes into registration (the journey
  // suite's proven entry) — there is no separate register button to hunt for.
  await clickAction(page, /continue|sign in/i, ["submit"]);
  await expect(
    page.getByRole("heading", { name: /create|register|sign up|no-account/i }),
  ).toBeVisible({ timeout: 30_000 });

  await fillIfVisible(page, /email/i, who.email);
  await clickActionIfVisible(page, /continue.*password|password/i, ["submit"]);
  await page.getByLabel(/password/i).first().fill(who.password);
  await clickAction(page, /continue|sign up|create account|register/i, ["submit"]);
  await skipPasskeyUpsellIfVisible(page);

  await page.waitForURL(/\/admin(?:[/?#]|$)/, { timeout: 30_000 });

  // The flow, not the kit, must have created the user (the project secret
  // scopes the list; the response is a plain array of user documents).
  const users = (await zitadel.api.listUsers({ limit: 100 })) as Array<{ email?: string }>;
  const created = users.find((user) => user.email === who.email);
  expect(created).toBeDefined();
});

async function skipPasskeyUpsellIfVisible(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: /skip for now/i });
  const outcome = await Promise.race([
    skip.waitFor({ state: "visible", timeout: 30_000 }).then(() => "upsell" as const),
    page
      .waitForURL(/\/admin(?:[/?#]|$)/, { timeout: 30_000 })
      .then(() => "done" as const),
  ]);
  if (outcome === "upsell") {
    await skip.click();
  }
}

async function clickAction(page: Page, name: RegExp, actionNames: string[]): Promise<void> {
  const target = actionCandidates(page, name, actionNames).find(Boolean);
  for (const candidate of actionCandidates(page, name, actionNames)) {
    if (await candidate.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
      await candidate.first().click();
      return;
    }
  }
  await (target as Locator).first().click();
}

async function clickActionIfVisible(
  page: Page,
  name: RegExp,
  actionNames: string[],
): Promise<void> {
  for (const candidate of actionCandidates(page, name, actionNames)) {
    if (await candidate.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
      await candidate.first().click();
      return;
    }
  }
}

function actionCandidates(page: Page, name: RegExp, actionNames: string[]): Locator[] {
  return [
    ...actionNames.flatMap((action) => [
      page.getByTestId(`zitadel-action-${action}-button`),
      page.getByTestId(`zitadel-action-${action}-link`),
      page.locator(`zl-button[action="${action}"], [data-action="${action}"]`),
    ]),
    page.getByRole("button", { name }),
    page.getByRole("link", { name }),
  ];
}

async function fillIfVisible(page: Page, label: RegExp, value: string): Promise<void> {
  const field = page.getByLabel(label).first();
  if (await field.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await field.fill(value);
  }
}
