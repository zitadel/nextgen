import { expect, test } from "@playwright/test";

import { recordPolicyViolations } from "../support/policy";

test("the website hydrates and navigates under its enforced hash policy", async ({ page }) => {
  const violations = await recordPolicyViolations(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "Changelog", exact: true }).first().click();
  await expect(page).toHaveURL(/\/changelog$/);
  const entry = page.locator('main a[href^="/changelog/"]').first();
  await entry.click();
  await expect(page).toHaveURL(/\/changelog\/[^/]+$/);
  expect(violations, "policy violations").toEqual([]);
});

test("the website blocks an inline script absent from its CSP hashes", async ({ page }) => {
  const violations = await recordPolicyViolations(page);
  // Do not turn the deliberate violation into a production log on deployment runs.
  await page.route("**/csp-report", (route) => route.fulfill({ status: 204 }));
  await page.goto("/");
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = 'document.documentElement.dataset.untrustedScript = "ran"';
    document.head.append(script);
  });
  await expect
    .poll(() =>
      violations.some((violation) => violation.startsWith("enforce script-src-elem inline")),
    )
    .toBe(true);
  await expect(page.locator("html")).not.toHaveAttribute("data-untrusted-script", "ran");
});

test("an unknown website URL stays readable under its scriptless fallback", async ({ page }) => {
  const response = await page.goto("/changelog/no-such-entry-security-policy");
  expect(response?.status()).toBe(404);
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'none'");
  await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  await page.getByRole("link", { name: "changelog", exact: true }).last().click();
  await expect(page).toHaveURL(/\/changelog$/);
});
