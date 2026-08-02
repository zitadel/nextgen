import type { Locator, Page } from "@playwright/test";

/**
 * Resilient widget interaction shared by the real-flow specs: prefer the
 * orchestrator's stable action testids, fall back to roles — the journey
 * suite's proven pattern for flows that span multiple steps.
 */
export async function clickAction(
  page: Page,
  name: RegExp,
  actionNames: string[],
): Promise<void> {
  const target = actionCandidates(page, name, actionNames).find(Boolean);
  for (const candidate of actionCandidates(page, name, actionNames)) {
    if (await candidate.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
      await candidate.first().click();
      return;
    }
  }
  await (target as Locator).first().click();
}

export async function clickActionIfVisible(
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

export async function fillIfVisible(page: Page, label: RegExp, value: string): Promise<void> {
  const field = page.getByLabel(label).first();
  if (await field.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await field.fill(value);
  }
}
