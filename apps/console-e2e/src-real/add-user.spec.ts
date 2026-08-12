import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

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

test.describe.configure({ mode: "parallel" });

// The Projects block is out of the MVP: design removed the project selector
// (design decisions log D6, 2026-07-31), and the backend could not grant access
// regardless — roles need ADR 034's app-group catalog (epic #419) and
// `queryProjects` is single-project (ADR 0004). D6 expects it back in a future
// version, so the cases below are parked with the block, not deleted; restore
// them alongside the block and the unit specs when both reasons clear.

/** Signs in, lands on /users and opens the drawer. */
async function openDrawer(page: Page, user: { email: string; password: string }) {
  await signIn(page, user);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add user" });
  await expect(drawer).toBeVisible();
  // Two fetches gate the form: the drawer shows "Loading schemas…" until the
  // list resolves, and fields mount only once the selected schema's definition
  // arrives. Locator actions auto-wait through both, but one-shot reads
  // (`renderedFields`) and raw key presses don't — so only hand tests a drawer
  // whose form is actually on screen.
  await expect(drawer.locator('input[data-slot="input"]').first()).toBeVisible();
  return drawer;
}

/** Unique per call so parallel workers never collide on the unique email. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}@example.com`;
}

/** The schema the console is scoped to, straight from the API. */
async function projectSchema(zitadel: {
  api: { getSchemaById: (id: string) => Promise<unknown> };
  handle: { schemaId: string };
}) {
  const schema = (await zitadel.api.getSchemaById(zitadel.handle.schemaId)) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    properties: Object.keys(schema.properties ?? {}).sort(),
    required: new Set(schema.required ?? []),
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
  const drawer = await openDrawer(page, await seed.user());

  // Both loading labels are excluded, not just the empty one: "Loading schemas…"
  // is also `not "Select schema"`, so waiting on that alone let the assertion
  // below run mid-fetch and compare against an empty field set.
  const picker = drawer.getByRole("combobox", { name: "User Schema" });
  await expect(picker).not.toContainText("Select schema");
  await expect(picker).not.toContainText("Loading schemas");

  // Polled rather than read once: `evaluateAll` takes a single snapshot and does
  // not retry, so it can land between the schema resolving and its fields
  // rendering.
  await expect.poll(() => renderedFields(drawer)).toEqual(schema.properties);
  await expectNoErrorBoundary(page);
});

test("marks only the properties the schema does not require", async ({ page, zitadel, seed }) => {
  const schema = await projectSchema(zitadel);
  const drawer = await openDrawer(page, await seed.user());

  for (const property of schema.properties) {
    const field = drawer
      .locator('[data-slot="field"]')
      .filter({ has: page.locator(`input[name="${property}"]`) });
    await expect(field.getByText("Optional")).toHaveCount(schema.required.has(property) ? 0 : 1);
  }
});

test("keeps submit disabled until every required property has a value", async ({
  page,
  zitadel,
  seed,
}) => {
  const schema = await projectSchema(zitadel);
  const drawer = await openDrawer(page, await seed.user());
  const submit = drawer.getByRole("button", { name: "Add user", exact: true });

  await expect(submit).toBeDisabled();

  for (const property of schema.required) {
    await drawer
      .locator(`input[name="${property}"]`)
      .fill(property === "email" ? uniqueEmail("gate") : "value");
  }
  await expect(submit).toBeEnabled();
});

test("creates a user and shows it in the list", async ({ page, zitadel, seed }) => {
  const schema = await projectSchema(zitadel);
  const drawer = await openDrawer(page, await seed.user());
  const email = uniqueEmail("created");

  for (const property of schema.required) {
    await drawer
      .locator(`input[name="${property}"]`)
      .fill(property === "email" ? email : "value");
  }
  await drawer.getByRole("button", { name: "Add user", exact: true }).click();

  // The drawer closes and the list refreshes with the new row. With only an
  // email the display name falls back to it (`lib/user.ts`).
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("link", { name: email, exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("surfaces the API's own message when the email is already taken", async ({ page, seed }) => {
  const existing = await seed.user();
  const drawer = await openDrawer(page, existing);

  // `email` is `x-unique: project` in the shipped schema.
  await drawer.getByLabel("Email").fill(existing.email);
  await drawer.getByRole("button", { name: "Add user", exact: true }).click();

  const alert = drawer.getByRole("alert");
  await expect(alert).toBeVisible();
  // ADR 030 makes the payload's `message` the human-facing string; the transport
  // string ("POST /users returned 409") must never reach an operator.
  await expect(alert).toContainText("already exists");
  await expect(alert).not.toContainText("returned 409");
  // The drawer stays open so the value can be corrected.
  await expect(drawer).toBeVisible();
});

test("discards the draft when cancelled", async ({ page, seed }) => {
  const user = await seed.user();
  const drawer = await openDrawer(page, user);
  const email = uniqueEmail("discarded");

  await drawer.getByLabel("Email").fill(email);
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drawer).toBeHidden();

  // Nothing was created, and reopening starts clean.
  await expect(page.getByText(email)).toHaveCount(0);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add user" }).getByLabel("Email")).toHaveValue("");
});

test("closes from the header without creating anything", async ({ page, seed }) => {
  const drawer = await openDrawer(page, await seed.user());
  const email = uniqueEmail("closed");

  await drawer.getByLabel("Email").fill(email);
  await drawer.getByRole("button", { name: "Close", exact: true }).click();

  await expect(drawer).toBeHidden();
  await expect(page.getByText(email)).toHaveCount(0);
});

// test("offers the real project and keeps roles empty until one exists", async ({
//   page,
//   zitadel,
//   seed,
// }) => {
//   const drawer = await openDrawer(page, await seed.user());
//
//   // Roles cannot be reached before a project is chosen.
//   await expect(drawer.getByRole("combobox", { name: "Select roles" })).toHaveAttribute(
//     "aria-disabled",
//     "true",
//   );
//
//   await drawer.getByRole("combobox", { name: "Select project" }).click();
//   // `queryProjects` is scope-pinned to the caller's own project (ADR 0004).
//   const option = page.getByRole("option").first();
//   await expect(option).toBeVisible();
//   await option.click();
//
//   const roles = drawer.getByRole("combobox", { name: "Select roles" });
//   await expect(roles).not.toHaveAttribute("aria-disabled", "true");
//   await roles.click();
//   // No endpoint serves a role catalogue yet (ADR 034 / epic #419), so the list
//   // opens honestly empty rather than showing an invented vocabulary.
//   await expect(page.getByText("No roles available.")).toBeVisible();
//   expect(zitadel.handle.projectId).toBeTruthy();
// });

// test("adds and removes a project row", async ({ page, seed }) => {
//   const drawer = await openDrawer(page, await seed.user());
//
//   // `Row · empty` carries no Remove — it appears once the row holds a project.
//   await expect(drawer.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
//
//   await drawer.getByRole("combobox", { name: "Select project" }).click();
//   await page.getByRole("option").first().click();
//
//   const remove = drawer.getByRole("button", { name: "Remove", exact: true });
//   await expect(remove).toBeVisible();
//   // One project, one row: nothing left to add.
//   await expect(drawer.getByRole("button", { name: /Add project/ })).toHaveCount(0);
//
//   await remove.click();
//   // Removing the only row frees the project again.
//   await expect(drawer.getByRole("button", { name: /Add project/ })).toBeVisible();
// });

// test("sends no project data on create", async ({ page, seed }) => {
//   const drawer = await openDrawer(page, await seed.user());
//   const email = uniqueEmail("no-grants");
//
//   const request = page.waitForRequest(
//     (candidate) =>
//       candidate.method() === "POST" && new URL(candidate.url()).pathname.endsWith("/api/users"),
//   );
//
//   await drawer.getByRole("combobox", { name: "Select project" }).click();
//   await page.getByRole("option").first().click();
//   await drawer.getByLabel("Email").fill(email);
//   await drawer.getByRole("button", { name: "Add user", exact: true }).click();
//
//   // `POST /users` accepts no grants, and the only selectable project is the one
//   // the create call is already scoped to — a chosen project changes nothing.
//   const body = JSON.parse((await request).postData() ?? "{}") as Record<string, unknown>;
//   expect(Object.keys(body).sort()).toEqual(["$schema", "email"]);
//   expect(body.email).toBe(email);
// });
//
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
  await signIn(page, await seed.user());
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();

  // Open the drawer from the toolbar without a pointer.
  await page.getByRole("button", { name: "Add", exact: true }).press("Enter");
  const drawer = page.getByRole("dialog", { name: "Add user" });
  await expect(drawer).toBeVisible();
  // Same readiness gate as `openDrawer`: a raw Tab loop never auto-waits, so
  // the schema-driven form must be on screen before traversal starts.
  await expect(drawer.locator('input[data-slot="input"]').first()).toBeVisible();

  const email = uniqueEmail("keyboard");
  for (const property of schema.required) {
    await tabUntil(page, (label) => label === property);
    await page.keyboard.type(property === "email" ? email : "value");
  }

  await tabUntil(page, (label) => label === "Add user");
  await page.keyboard.press("Enter");

  await expect(drawer).toBeHidden();
  await expect(page.getByRole("link", { name: email, exact: true })).toBeVisible();
});

test("opens and selects in the schema picker with the keyboard", async ({ page, seed }) => {
  const drawer = await openDrawer(page, await seed.user());
  const picker = drawer.getByRole("combobox", { name: "User Schema" });
  // The trigger is disabled until the schema list resolves; pressing before then
  // is a race the component correctly ignores.
  await expect(picker).not.toHaveAttribute("aria-disabled", "true");

  // ArrowDown is the conventional way to open a combobox, alongside Enter.
  await picker.press("ArrowDown");
  await expect(page.getByRole("option").first()).toBeVisible();
  // The search field takes focus so typing filters immediately.
  expect(await focused(page)).toBe("Search schemas");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(picker).not.toContainText("Select schema");
});

// test("reaches and operates the project picker with the keyboard", async ({ page, seed }) => {
//   const drawer = await openDrawer(page, await seed.user());
//   const project = drawer.getByRole("combobox", { name: "Select project" });
//
//   await project.press("Enter");
//   await expect(page.getByRole("option").first()).toBeVisible();
//   await page.keyboard.press("ArrowDown");
//   await page.keyboard.press("Enter");
//
//   await expect(project).not.toContainText("Select project");
//   // Roles become reachable only once a project is chosen.
//   await expect(drawer.getByRole("combobox", { name: "Select roles" })).not.toHaveAttribute(
//     "aria-disabled",
//     "true",
//   );
// });

// test("keeps the disabled roles control out of the tab order", async ({ page, seed }) => {
//   const drawer = await openDrawer(page, await seed.user());
//   const roles = drawer.getByRole("combobox", { name: "Select roles" });
//
//   await expect(roles).toHaveAttribute("aria-disabled", "true");
//   // A control that cannot be used must not be a tab stop.
//   await expect(roles).toHaveAttribute("tabindex", "-1");
//
//   // Tabbing from the project picker lands past it, on Cancel or Add user.
//   await drawer.getByRole("combobox", { name: "Select project" }).focus();
//   const landed = await tabUntil(page, (label) => label === "Cancel" || label === "Add user");
//   expect(["Cancel", "Add user"]).toContain(landed);
// });

test("Escape closes the open list first, then the drawer", async ({ page, seed }) => {
  const drawer = await openDrawer(page, await seed.user());
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

