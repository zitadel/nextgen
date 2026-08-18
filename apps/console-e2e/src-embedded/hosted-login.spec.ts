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
 *
 * The runtime document the shell discovers from is real here — this lane boots
 * a provisioned instance — so the cases that need a *different* deployment
 * state (no project yet, a server that cannot answer) stub the endpoint per
 * test. Those three states are the ones Console ADR 0004 §3 keeps apart, and
 * the shell's copy differs per state because its audience does: the setup hint
 * addresses whoever is standing up the deployment, the connectivity error
 * addresses someone who just wanted to sign in.
 */

const RUNTIME_URL = "**/console/runtime.json";

/** What a reachable server with no project yet answers (ADR 0004 §3, state 2). */
const AWAITING_SETUP = { mode: "standalone" };

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
  await page.getByRole("button", { name: "Continue", exact: true }).click();
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

// A caller-supplied id that does not resolve is neither of the shell's own
// screens and keeps the widget's own error, deliberately: the setup hint tells
// an operator to run `zitadel setup`, which is not the answer to a bad query
// parameter.
test("a caller-supplied unknown project keeps the widget's own error", async ({ page }) => {
  await page.goto("/ui/login/?project_id=proj_does_not_exist");
  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
});

test("a reachable deployment with no project yet shows the setup hint", async ({ page }) => {
  // This instance is bootstrapped past the state, so serve it directly. It is
  // the one case whose copy is aimed at an operator: a deployment with no
  // project has no application to send an end user here.
  await page.route(RUNTIME_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(AWAITING_SETUP),
    }),
  );

  await page.goto("/ui/login/");
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in is unavailable" })).toBeHidden();
});

test("an erroring runtime endpoint renders a retryable error, not the setup hint", async ({
  page,
  zitadel,
}) => {
  // The failure this replaces, and the reason it is not the narrow window it
  // sounds like: `/ui/login/` is served from the binary's embedded assets and
  // touches no storage, while `/console/runtime.json` is resolved per request
  // from the default project and answers 500 when that lookup fails. A healthy
  // binary in front of an unhealthy database hit exactly this, and told the
  // people trying to sign in that the deployment was never set up.
  let broken = true;
  await page.route(RUNTIME_URL, (route) =>
    broken
      ? route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: "failed to resolve console runtime metadata",
        })
      : route.continue(),
  );

  await page.goto("/ui/login/");
  await expect(page.getByRole("heading", { name: "Sign-in is unavailable" })).toBeVisible();
  await expect(page.getByText("the server answered 500")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeHidden();
  await expect(page.getByLabel("Email")).toHaveCount(0);

  // Retry is a real second attempt, not a reload hint: the next request goes
  // to the actual server, so a recovered deployment is one click from the
  // widget it should have rendered all along.
  broken = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  expect((await widgetProject(page)).projectId).toBe(zitadel.handle.projectId);
});

test("an unreachable runtime endpoint renders the same error", async ({ page }) => {
  await page.route(RUNTIME_URL, (route) => route.abort("failed"));

  await page.goto("/ui/login/");
  await expect(page.getByRole("heading", { name: "Sign-in is unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeHidden();
});

test("a 2xx body that is not the runtime document is an error, not a setup hint", async ({
  page,
}) => {
  // What a misrouting proxy answers with, and what `vite preview` answers with
  // for any unknown path. The shell used to tolerate it and fall through to
  // the hint; `mode` is the field that tells a real document from this one.
  await page.route(RUNTIME_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Zitadel sign-in</title>",
    }),
  );

  await page.goto("/ui/login/");
  await expect(page.getByRole("heading", { name: "Sign-in is unavailable" })).toBeVisible();
  await expect(page.getByText("the response was not valid JSON")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No project yet" })).toBeHidden();
});

// A wrongly-typed field is the same misdiagnosis one level down: `mode` is
// valid, so the document passes, and coercing the id to "absent" renders the
// setup hint for a document the shell could not read. Only an *omitted* id
// means "not provisioned" — that is how the server says it.
for (const [field, document] of [
  ["console_project_id", { mode: "standalone", console_project_id: 42 }],
  ["publishable_key", { mode: "standalone", console_project_id: "proj_x", publishable_key: 42 }],
] as const) {
  test(`a non-string ${field} is a malformed document, not "no project yet"`, async ({ page }) => {
    await page.route(RUNTIME_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(document),
      }),
    );

    await page.goto("/ui/login/");
    await expect(page.getByRole("heading", { name: "Sign-in is unavailable" })).toBeVisible();
    await expect(page.getByText("the response was not a runtime document")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No project yet" })).toBeHidden();
    await expect(page.getByLabel("Email")).toHaveCount(0);
  });
}
