import { expect, test } from "@playwright/test";

/**
 * The browser checks: the built site hydrates and navigates, and it wears the
 * console's look. Everything else the suite proves over HTTP.
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

/**
 * A section is one row of the sidebar's top level; inside it the sidebar lists
 * only the section, under a row that steps back up without leaving the page
 * (components/sidebar.tsx).
 */
test("the sidebar steps down into a section and back up", async ({ page }) => {
  const sidebar = page.locator("#nd-sidebar");
  await page.goto("/docs/get-started/quickstart");

  await sidebar.getByRole("link", { name: "CLI reference" }).click();
  await expect(page).toHaveURL(/\/docs\/reference\/cli$/);
  await expect(sidebar.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(sidebar.getByRole("link", { name: "Quickstart" })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "Back to all sections from CLI reference" }).click();
  await expect(sidebar.getByRole("link", { name: "API reference" })).toBeVisible();
  await expect(page).toHaveURL(/\/docs\/reference\/cli$/);

  await sidebar.getByRole("button", { name: "CLI reference", exact: true }).click();
  await expect(sidebar.getByRole("link", { name: "Overview" })).toBeVisible();
});

/**
 * app/global.css reaches into Fumadocs' layout by its element ids (the
 * Spacious frame, the page panel, the page's title), so a Fumadocs upgrade
 * that renames one would quietly drop part of the look. Each value is compared
 * with the design token it should resolve to, never with a hex value.
 */
test("a page wears the console's colours, faces and code colours in both themes", async ({
  page,
}) => {
  const looks: Record<string, string> = {};

  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/docs/get-started/quickstart");
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
    await expect(page.getByRole("img", { name: "Zitadel" })).toBeVisible();

    const look = await page.evaluate(async () => {
      await document.fonts.ready;
      // What a CSS value resolves to on this page, e.g. var(--zl-background).
      const resolve = (property: "color" | "fontFamily", value: string) => {
        const probe = document.createElement("span");
        probe.style[property] = value;
        document.body.append(probe);
        const resolved = getComputedStyle(probe)[property];
        probe.remove();
        return resolved;
      };
      const style = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`nothing matches ${selector}`);
        return getComputedStyle(element);
      };
      const firstFace = (family: string) => (family.split(",")[0] ?? "").trim();
      const title = style("#nd-page > h1");
      const section = style(".prose h2");

      return {
        panel: [style("#nd-page-panel").backgroundColor, resolve("color", "var(--zl-background)")],
        frame: [
          style("#fd-spacious-layout").backgroundColor,
          resolve("color", "var(--zl-sidebar)"),
        ],
        sidebar: [style("#nd-sidebar").backgroundColor, resolve("color", "var(--zl-sidebar)")],
        text: [
          firstFace(style("body").fontFamily),
          firstFace(resolve("fontFamily", "var(--font-arimo)")),
        ],
        title: [
          firstFace(title.fontFamily),
          firstFace(resolve("fontFamily", "var(--font-apk-futural)")),
        ],
        section: [firstFace(section.fontFamily), firstFace(title.fontFamily)],
        weight: [title.fontWeight, "400"],
        code: [
          style('pre span[style*="--zl-shiki-token-string"]').color,
          resolve("color", "var(--zl-syntax-string)"),
        ],
      } as const;
    });

    for (const [part, [actual, expected]] of Object.entries(look)) {
      expect(actual, `${scheme}: ${part}`).toBe(expected);
    }
    looks[scheme] = look.panel[0];
  }

  // The tokens switched with the theme, not only the attribute.
  expect(looks.dark).not.toBe(looks.light);
});
