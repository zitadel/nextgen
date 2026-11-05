import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { ERROR_STATE_TITLE } from "./copy";

/**
 * Asserts no error boundary rendered.
 *
 * Worth its own check because a boundary replaces the screen entirely: without
 * it, an assertion that some element is *absent* passes just as happily when the
 * whole route failed to load.
 */
export async function expectNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText(ERROR_STATE_TITLE)).toHaveCount(0);
}

/**
 * Opens the Add team drawer from the Teams screen the page shows, and returns
 * it with its name field and submit button.
 */
export async function openAddTeam(page: Page) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add team" });
  await expect(drawer).toBeVisible();
  return {
    drawer,
    name: drawer.getByLabel("Team name"),
    submit: drawer.getByRole("button", { name: "Add team", exact: true }),
  };
}

/**
 * A name unique per call, for what a project keeps unique by name (teams). The
 * two workers share one instance, so a `Date.now()` name can come up twice.
 */
export function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
