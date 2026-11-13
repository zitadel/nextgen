import { expect, test } from "@zitadel/testing/playwright";

import { withErrorBody } from "../support/api";
import { expectNoErrorBoundary, uniqueName } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The Webhooks screens against a real instance.
 *
 * The unit specs drive them over stubbed responses. This proves the round
 * trips only a live server shows: its refusal of a URL that is not `https`
 * reaches the field, a webhook added through the drawer is stored and comes
 * back on reload, the signing secret the server made is shown and is gone
 * after that reload, disabling persists, a rotation returns another secret
 * and starts the previous one's 24 hours, and a delete takes the row away.
 *
 * The endpoint is unique to the run and never called: a new webhook gets no
 * history, and nothing here waits for a delivery. The test removes what it
 * added, whatever step it stopped at: a project holds ten webhooks at most.
 */
test("adds a webhook, shows its secret once, disables, rotates and deletes it", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  const params = { project_id: zitadel.handle.projectId };
  const url = `https://${uniqueName("e2e")}.example.com/hooks/zitadel`;

  try {
    await page.goto("/webhooks");
    await expect(page.getByRole("heading", { name: "Webhooks", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Add webhook" });
    const endpoint = drawer.getByLabel("Endpoint URL");
    const submit = drawer.getByRole("button", { name: "Add webhook", exact: true });

    // The server refuses a URL that is not https. Its refusal lands on the
    // field and the drawer stays: nothing was written.
    await endpoint.fill(url.replace("https://", "http://"));
    await submit.click();
    await expect(endpoint).toHaveAttribute("aria-invalid", "true");
    await expect(drawer).toBeVisible();

    await endpoint.fill(url);
    await drawer.getByRole("radio", { name: /Selected events/ }).click();
    await drawer.getByRole("combobox", { name: "Event types" }).click();
    await page.getByRole("option", { name: "user.created", exact: true }).click();
    await page.keyboard.press("Escape");
    await submit.click();

    // The secret the server generated, this once.
    const secretDialog = page.getByRole("alertdialog", { name: "Signing secret" });
    const secret = secretDialog.locator("code");
    await expect(secret).toHaveText(/^whsec_/);
    const first = await secret.innerText();
    await secretDialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(secretDialog).toBeHidden();

    // The row is the record re-read, and no read returns the secret again.
    await page.reload();
    const row = page.getByRole("row").filter({ hasText: url });
    await expect(row.getByText("user.created", { exact: true })).toBeVisible();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText(/whsec_/)).toHaveCount(0);

    await row.getByRole("link", { name: url, exact: true }).click();
    await expect(page).toHaveURL(/\/webhooks\/hook_[A-Z0-9]+\?project=/);
    await expect(page.getByRole("heading", { name: url, exact: true })).toBeVisible();

    // Disabling is the server's state, not the button's.
    await page.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(page.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Enable", exact: true })).toBeVisible();

    // A rotation returns another secret and says how long the previous one lasts.
    await page.getByRole("button", { name: "Rotate secret", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Rotate signing secret?" })
      .getByRole("button", { name: "Rotate secret", exact: true })
      .click();
    await expect(secret).toHaveText(/^whsec_/);
    expect(await secret.innerText()).not.toBe(first);
    await expect(secretDialog.getByText(/previous secret keeps working until/)).toBeVisible();
    await secretDialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(secretDialog).toBeHidden();

    await page.getByRole("button", { name: "Delete webhook", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Delete webhook?" })
      .getByRole("button", { name: "Delete webhook", exact: true })
      .click();
    await expect(page).toHaveURL(/\/webhooks\?project=/);
    await expect(page.getByRole("link", { name: url, exact: true })).toBeHidden();
    await expectNoErrorBoundary(page);
  } finally {
    const { data } = await withErrorBody(zitadel.api.listWebhooks({ ...params, limit: 100 }));
    for (const webhook of data.filter((candidate) => candidate.url === url)) {
      await withErrorBody(zitadel.api.deleteWebhook(webhook.id, params));
    }
  }
});
