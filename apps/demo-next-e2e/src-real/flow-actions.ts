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
  const candidates = actionCandidates(page, name, actionNames);
  for (const candidate of candidates) {
    if (await candidate.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
      await candidate.first().click();
      return;
    }
  }
  // Nothing was visible within the probes: fall back to an auto-waiting click
  // on the first (most specific) candidate.
  await candidates[0].first().click();
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
