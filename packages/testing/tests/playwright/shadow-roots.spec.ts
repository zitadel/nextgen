import { connectZitadel } from "../../src/index";
import {
  expect,
  test,
  type ZitadelTestFixtures,
  type ZitadelWorkerFixtures,
  widgetTest,
} from "../../src/playwright";
import type { InstanceHandle, MintedSession } from "../../src/types";

/**
 * Run by `tests/unit/shadow-roots-browser.test.ts` through the Playwright
 * runner, in a real Chromium: each fixture the kit exports must hand the test
 * a page on which a closed shadow root attaches open, before the page's own
 * scripts run. `data:` pages have no scripts of their own to open them.
 */

const PAGE = "data:text/html,<p>page</p>";
const ATTACHES_CLOSED_ROOT_OPEN =
  "document.createElement('div').attachShadow({ mode: 'closed' }).host.shadowRoot !== null";

const handle: InstanceHandle = {
  baseUrl: "http://localhost:1",
  projectId: "p",
  projectSecret: "s",
  schemaId: "x",
};

const session: MintedSession = {
  user: { id: "u", email: "a@b.test", password: "pw" },
  sessionToken: "t",
  expiresAt: "2999-01-01T00:00:00Z",
  cookie: {
    name: "session",
    value: "v",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
    path: "/",
  },
};

// Declared apart: the kit's own fixture is `auto`, and an override must be too.
const workerAuto = { scope: "worker", auto: true } as const;

const withFakeSession = test.extend<ZitadelTestFixtures, ZitadelWorkerFixtures>({
  zitadel: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature requires the destructuring pattern
    async ({}, use) => {
      await use({ ...connectZitadel(handle), seedSession: async () => session });
    },
    workerAuto,
  ],
});

widgetTest("widgetTest opens the roots of its page", async ({ page }) => {
  await page.goto(PAGE);
  expect(await page.evaluate(ATTACHES_CLOSED_ROOT_OPEN)).toBe(true);
});

widgetTest("widgetTest opens the roots of a page it opens later", async ({ context }) => {
  const later = await context.newPage();
  await later.goto(PAGE);
  expect(await later.evaluate(ATTACHES_CLOSED_ROOT_OPEN)).toBe(true);
});

test("test opens the roots of its page", async ({ page }) => {
  await page.goto(PAGE);
  expect(await page.evaluate(ATTACHES_CLOSED_ROOT_OPEN)).toBe(true);
});

withFakeSession(
  "authenticatedPage opens the roots of its own context",
  async ({ authenticatedPage }) => {
    await authenticatedPage.page.goto(PAGE);
    expect(await authenticatedPage.page.evaluate(ATTACHES_CLOSED_ROOT_OPEN)).toBe(true);
  },
);
