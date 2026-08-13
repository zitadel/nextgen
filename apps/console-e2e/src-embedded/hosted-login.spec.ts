import type { Page } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

/**
 * The hosted sign-in shell the binary serves at `/ui/login/`
 * (`apps/login-ui`).
 *
 * It lives in the console suite because it is the same binary, the same mux,
 * and the same gap: nothing served either embedded surface the way a customer
 * receives it, so `/ui/login/` shipped falling back to the literal project id
 * `"demo"` and rendered "flow definition: not found" on every deployment.
 *
 * The shell sets no `post-sign-in-url`, so it stops at the terminal step and
 * emits `zitadel-flow-complete` for the host to act on rather than exchanging
 * the handoff itself. These cases follow it exactly that far.
 */

interface FlowCompletion {
  behavior: string;
  handoff_token?: string;
}

/**
 * Resolves with the terminal-step event. Install it *before* submitting the
 * last step — the widget emits once, and a listener attached afterwards
 * would wait forever.
 */
function flowCompletion(page: Page): Promise<FlowCompletion> {
  return page.evaluate(
    () =>
      new Promise<FlowCompletion>((resolve) => {
        // The event is composed and bubbling, so document sees it.
        document.addEventListener(
          "zitadel-flow-complete",
          (event) => resolve((event as CustomEvent<FlowCompletion>).detail),
          { once: true },
        );
      }),
  );
}

/** The widget's resolved config, read off the element the shell configured. */
function widgetProject(page: Page): Promise<{ projectId?: string; publishableKey?: string }> {
  return page.evaluate(() => {
    // `@zitadel/components` is not a dependency of this suite, so the element
    // type augmentation is not in scope here.
    const login = document.querySelector("zitadel-login") as
      | (Element & { project?: { projectId?: string; publishableKey?: string } })
      | null;
    return {
      projectId: login?.project?.projectId,
      publishableKey: login?.project?.publishableKey,
    };
  });
}

test("signs into the deployment's project with no query parameter", async ({ page, seed }) => {
  const user = await seed.user();

  await page.goto("/ui/login/");

  // The step renders only when the flow definition resolved, which requires a
  // project that exists. `"demo"` never did.
  await expect(page.getByLabel("Email")).toBeVisible();

  // Discovery has to carry both fields: the id above, and the publishable key
  // the handoff exchange needs. The declarative attribute path cannot express
  // a key at all, so this also pins that the shell configures the widget by
  // property.
  const project = await widgetProject(page);
  expect(project.projectId).toMatch(/^proj_/);
  expect(project.publishableKey).toBeTruthy();

  const completion = flowCompletion(page);

  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // A real user authenticated against the deployment's real project: the
  // handoff token is what a host would exchange for a session.
  await expect(completion).resolves.toMatchObject({ behavior: "show" });
  expect((await completion).handoff_token).toBeTruthy();
});

test("discovers the same project the runtime document names", async ({ page, zitadel }) => {
  await page.goto("/ui/login/");
  await expect(page.getByLabel("Email")).toBeVisible();
  expect((await widgetProject(page)).projectId).toBe(zitadel.handle.projectId);
});

test("an explicit ?project_id= still wins over discovery", async ({ page, zitadel }) => {
  await page.goto(`/ui/login/?project_id=${zitadel.handle.projectId}`);
  await expect(page.getByLabel("Email")).toBeVisible();
  const project = await widgetProject(page);
  expect(project.projectId).toBe(zitadel.handle.projectId);
  // The discriminator: the suite's only project id is the deployment's own,
  // so the id alone cannot tell param-won from discovery-won. The explicit
  // path skips the runtime fetch entirely, so no publishable key proves the
  // param path actually ran.
  expect(project.publishableKey).toBeUndefined();
});

// The shell's other branch — the setup hint — needs a deployment with no
// project at all, which this suite's instance is bootstrapped past. A
// caller-supplied id that does not resolve is a different case and keeps the
// widget's own error, deliberately: the hint tells an operator to run
// `zitadel setup`, which is not the answer to a bad query parameter.
test("a caller-supplied unknown project keeps the widget's own error", async ({ page }) => {
  await page.goto("/ui/login/?project_id=proj_does_not_exist");
  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
});
