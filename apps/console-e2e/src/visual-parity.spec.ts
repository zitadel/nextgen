/**
 * Visual parity sweep — the paired React components in `@zitadel-nextgen/ui-react`
 * must render identical visuals to the Lit atoms in
 * `@zitadel-nextgen/components`.
 *
 * Strategy: the console mirrors `packages/components/dev/pages/atoms.ts`.
 * We assert structural shape (counts, presence) on each atom matrix.
 * Lit correctness is enforced by the components package's unit/browser
 * tests and by manual side-by-side comparison against
 * `http://localhost:5173/?route=atoms`.
 */
import { expect, test } from "@playwright/test";

test.describe("Paired React surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="atom-playground"]', {
      state: "visible",
    });
  });

  test("renders the full button matrix", async ({ page }) => {
    // Figma master variant set (6598:292) ships two matrices, each
    // shaped 5 cols × (3 hierarchies × 2 sizes) = 30 buttons:
    //   Core     — state matrix (Enabled / Hovered / Focused / Pressed / Disabled)
    //   Variants — content matrix (None / Leading / Trailing / Loading / Icon-only)
    // Total: 60. If somebody collapses the React pair or strips a
    // variant, this catches the change before screenshots disagree.
    const buttons = page.locator('[data-testid="button-matrix"] .zr-btn');
    await expect(buttons.first()).toBeVisible();
    await expect(buttons).toHaveCount(60);
  });

  test("mirrors the Lit alert matrix", async ({ page }) => {
    // Figma master `6593:2640` × 4 severities × { body, +heading, +dismissible }.
    const alerts = page.locator('[data-testid="alert-matrix"] .zr-alert');
    await expect(alerts).toHaveCount(12);
  });

  test("mirrors the Lit field matrix", async ({ page }) => {
    // Figma Text Field master `4390:1404`: 7 state columns + Password forgot row.
    const fields = page.locator('[data-testid="field-matrix"] .zr-field');
    await expect(fields).toHaveCount(8);
  });

  test("mirrors the Lit icon matrix", async ({ page }) => {
    // Icons set `4103:10466`: 13 glyphs × 2 sizes + 4 tone samples.
    const icons = page.locator('[data-testid="icon-matrix"] .zr-icon');
    await expect(icons).toHaveCount(30);
  });

  test("mirrors the Lit pill row", async ({ page }) => {
    const pills = page.locator('[data-testid="pill-matrix"] .zr-pill');
    await expect(pills).toHaveCount(5);
  });

  test("mirrors the Lit card surface matrix", async ({ page }) => {
    const cards = page.locator('[data-testid="card-matrix"] .zr-card');
    await expect(cards).toHaveCount(2);
  });

  test("mirrors the Lit page-shell demo", async ({ page }) => {
    await expect(page.locator('[data-testid="page-shell-demo"] .zr-page-shell')).toHaveCount(1);
    await expect(page.locator('[data-testid="page-shell-demo"] .zr-card')).toHaveCount(1);
  });
});
