import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * End-to-end coverage for the Add user drawer (issue #633) against a real
 * instance, so the schema-driven form is exercised over the actual
 * `GET /schemas` → `POST /users` round trip rather than a mocked one.
 *
 * The unit specs cover component behaviour with stubbed schemas; these cover the
 * parts only a live backend proves: that the seeded schema really does drive the
 * field set, that a create reaches the list, and that a duplicate surfaces the
 * server's own message.
 */

/**
 * Signs in, lands on /users and opens the drawer, with the seeded schema picked
 * unless `pick` is false.
 */
async function openDrawer(
  page: Page,
  zitadel: Parameters<typeof signIn>[1],
  user: Parameters<typeof signIn>[2],
  { pick = true }: { pick?: boolean } = {},
) {
  await signIn(page, zitadel, user);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add user" });
  await expect(drawer).toBeVisible();
  if (pick) await pickSeededSchema(page, drawer, zitadel);
  return drawer;
}

/**
 * Picks the seeded schema in the open drawer, by name: the drawer preselects
 * only a project's single schema, and specs running in parallel on the
 * instance add schemas of their own.
 */
async function pickSeededSchema(
  page: Page,
  drawer: Locator,
  zitadel: Parameters<typeof signIn>[1],
) {
  await drawer.getByRole("combobox", { name: "User Schema" }).click();
  await page.getByRole("option", { name: (await projectSchema(zitadel)).name }).click();
  // Closed before a test reopens it, so its options never pass for the new list.
  await expect(page.getByRole("option")).toHaveCount(0);
  // One fetch gates the form: the drawer shows "Loading schemas…" until the
  // list — which carries each schema's document (#921) — resolves and the
  // fields mount. Locator actions auto-wait through it, but one-shot reads
  // (`renderedFields`) and raw key presses don't — so only hand tests a drawer
  // whose form is actually on screen.
  await expect(drawer.locator('input[data-slot="input"]').first()).toBeVisible();
}

/** The schema the console is scoped to, straight from the API. */
async function projectSchema(zitadel: Parameters<typeof signIn>[1]) {
  const { schema } = await zitadel.api.getSchemaById(zitadel.handle.schemaId);
  return {
    // As the picker lists it (`schemaDisplayName`).
    name: String(schema.title ?? schema.objectType ?? zitadel.handle.schemaId),
    properties: Object.keys(schema.properties ?? {}).sort(),
    required: new Set((schema.required as string[] | undefined) ?? []),
  };
}

/** Input `name` attributes the drawer rendered, sorted. */
async function renderedFields(drawer: Locator): Promise<string[]> {
  const names = await drawer
    .locator('input[data-slot="input"]')
    .evaluateAll((inputs) => inputs.map((input) => input.getAttribute("name") ?? ""));
  return names.sort();
}

test("renders exactly the properties the API's schema defines", async ({ page, zitadel, seed }) => {
  // Asserted against the API rather than hardcoded labels: the field set is
  // schema-driven, so the test has to be too — instances seed different schemas.
  const schema = await projectSchema(zitadel);
  const drawer = await openDrawer(page, zitadel, await seed.user());

  // The picker names the seeded schema, so the fields below are its own.
  const picker = drawer.getByRole("combobox", { name: "User Schema" });
  await expect(picker).toContainText(schema.name);

  // Polled rather than read once: `evaluateAll` takes a single snapshot and does
  // not retry, so it can land between the schema resolving and its fields
  // rendering.
  await expect.poll(() => renderedFields(drawer)).toEqual(schema.properties);
  await expectNoErrorBoundary(page);
});

test("creates a user and shows it in the list", async ({ page, zitadel, seed }) => {
  const schema = await projectSchema(zitadel);
  const drawer = await openDrawer(page, zitadel, await seed.user());
  const email = seed.identity().email;

  for (const property of schema.required) {
    await drawer.locator(`input[name="${property}"]`).fill(property === "email" ? email : "value");
  }
  await drawer.getByRole("button", { name: "Add user", exact: true }).click();

  // The drawer closes and the list refreshes with the new row. With only an
  // email the display name falls back to it (`features/users/model.ts`).
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("link", { name: email, exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("surfaces the API's own message when the email is already taken", async ({
  page,
  zitadel,
  seed,
}) => {
  const existing = await seed.user();
  const drawer = await openDrawer(page, zitadel, existing);

  // `email` is `x-unique: project` in the shipped schema.
  await drawer.getByLabel("Email").fill(existing.email);
  await drawer.getByRole("button", { name: "Add user", exact: true }).click();

  const alert = drawer.getByRole("alert");
  await expect(alert).toBeVisible();
  // ADR 030 makes the payload's `message` the human-facing string; the transport
  // string ("POST /users returned 409") must never reach an operator.
  await expect(alert).toContainText("already exists");
  // The server names the taken field.
  await expect(alert).toContainText("(email)");
  await expect(alert).not.toContainText("returned 409");
  // The drawer stays open so the value can be corrected.
  await expect(drawer).toBeVisible();
});

test("discards the draft when cancelled", async ({ page, zitadel, seed }) => {
  const user = await seed.user();
  const drawer = await openDrawer(page, zitadel, user);
  const email = seed.identity().email;

  await drawer.getByLabel("Email").fill(email);
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drawer).toBeHidden();

  // Nothing was created, and reopening starts clean.
  await expect(page.getByText(email)).toHaveCount(0);
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  // Read before any pick: picking a schema clears the values itself. Parallel
  // specs decide how many schemas the drawer offers. With several, a discarded
  // draft leaves none picked; with one, the drawer picks it again and its
  // fields start empty. A kept draft fails either check.
  const picker = drawer.getByRole("combobox", { name: "User Schema" });
  await expect(picker).not.toHaveAttribute("aria-disabled", "true");
  if ((await picker.textContent())?.includes("Select schema")) {
    await expect(drawer.getByLabel("Email")).toHaveCount(0);
  } else {
    await expect(drawer.getByLabel("Email")).toHaveValue("");
  }
});

test("closes from the header without creating anything", async ({ page, zitadel, seed }) => {
  const drawer = await openDrawer(page, zitadel, await seed.user());
  const email = seed.identity().email;

  await drawer.getByLabel("Email").fill(email);
  await drawer.getByRole("button", { name: "Close", exact: true }).click();

  await expect(drawer).toBeHidden();
  await expect(page.getByText(email)).toHaveCount(0);
});

/** What currently holds focus, described the way a keyboard user perceives it. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "none";
    return (
      el.getAttribute("aria-label") ??
      el.getAttribute("name") ??
      el.getAttribute("placeholder") ??
      el.textContent?.trim().slice(0, 24) ??
      el.tagName
    );
  });
}

/** Presses Tab until `predicate` matches, so tests assert reachability not counts. */
async function tabUntil(page: Page, predicate: (label: string) => boolean, limit = 20) {
  for (let i = 0; i < limit; i++) {
    const label = await focused(page);
    if (predicate(label)) return label;
    await page.keyboard.press("Tab");
  }
  throw new Error(`never reached target within ${limit} tabs; last focus: ${await focused(page)}`);
}

test("can be completed with the keyboard alone", async ({ page, zitadel, seed }) => {
  const schema = await projectSchema(zitadel);
  await signIn(page, zitadel, await seed.user());
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();

  // Open the drawer from the toolbar without a pointer.
  await page.getByRole("button", { name: "Add user", exact: true }).press("Enter");
  const drawer = page.getByRole("dialog", { name: "Add user" });
  await expect(drawer).toBeVisible();
  // The seeded schema, picked without a pointer (see `pickSeededSchema`).
  const picker = drawer.getByRole("combobox", { name: "User Schema" });
  await expect(picker).not.toHaveAttribute("aria-disabled", "true");
  await picker.press("ArrowDown");
  await expect(page.getByPlaceholder("Search schemas")).toBeFocused();
  await page.keyboard.type(schema.name);
  // Enter acts on the highlighted option, which the filter moves after typing.
  await expect(page.getByRole("option", { name: schema.name })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option")).toHaveCount(0);
  // Same readiness gate as `openDrawer`: a raw Tab loop never auto-waits, so
  // the schema-driven form must be on screen before traversal starts.
  await expect(drawer.locator('input[data-slot="input"]').first()).toBeVisible();

  const email = seed.identity().email;
  for (const property of schema.required) {
    await tabUntil(page, (label) => label === property);
    await page.keyboard.type(property === "email" ? email : "value");
  }

  await tabUntil(page, (label) => label === "Add user");
  await page.keyboard.press("Enter");

  await expect(drawer).toBeHidden();
  await expect(page.getByRole("link", { name: email, exact: true })).toBeVisible();
});

test("opens and selects in the schema picker with the keyboard", async ({
  page,
  zitadel,
  seed,
}) => {
  // Not picked on open, so only the keyboard selection below can name it.
  const drawer = await openDrawer(page, zitadel, await seed.user(), { pick: false });
  const picker = drawer.getByRole("combobox", { name: "User Schema" });
  // The trigger is disabled until the schema list resolves; pressing before then
  // is a race the component correctly ignores.
  await expect(picker).not.toHaveAttribute("aria-disabled", "true");

  // ArrowDown is the conventional way to open a combobox, alongside Enter.
  await picker.press("ArrowDown");
  await expect(page.getByRole("option").first()).toBeVisible();
  // The search field takes focus so typing filters immediately.
  expect(await focused(page)).toBe("Search schemas");

  // Filtered to the seeded schema, since parallel specs can add others.
  const { name } = await projectSchema(zitadel);
  await page.keyboard.type(name);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(picker).toContainText(name);
});

test("Escape closes the open list first, then the drawer", async ({ page, zitadel, seed }) => {
  const drawer = await openDrawer(page, zitadel, await seed.user());
  const picker = drawer.getByRole("combobox", { name: "User Schema" });
  await expect(picker).not.toHaveAttribute("aria-disabled", "true");

  await picker.press("Enter");
  await expect(page.getByRole("option").first()).toBeVisible();

  // First Escape dismisses the list but leaves the drawer open.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(drawer).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
