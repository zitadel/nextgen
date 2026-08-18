/* oxlint-disable playwright/expect-expect */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

// The pre-existing-app lane (ADR 044): setup met a host app it did not
// scaffold, so the emitted auth/profile pages must take the widget posture
// and the host's own shell, homepage, and theme must survive. The fixture
// under fixtures/preexisting/<framework> is the source of the "Orbit Notes"
// markers asserted here. Registered conditionally like the preset journeys;
// the register → profile → sign out → sign in loop itself runs in
// user-journey.spec.ts against the same app.
const preexisting = process.env.JOURNEY_PREEXISTING_APP === "1";
const framework = process.env.JOURNEY_FRAMEWORK ?? "next";

const MANAGED_MARKER = "zitadel-cli: managed-file";

const filesByFramework: Record<
  string,
  { authPages: string[]; homepage: string; shell: string }
> = {
  next: {
    authPages: ["app/login/page.tsx", "app/register/page.tsx", "app/profile/page.tsx"],
    homepage: "app/page.tsx",
    shell: "app/layout.tsx",
  },
  nuxt: {
    authPages: ["app/pages/login.vue", "app/pages/register.vue", "app/pages/profile.vue"],
    homepage: "app/pages/index.vue",
    shell: "app/app.vue",
  },
};

if (preexisting) {
  const files = filesByFramework[framework];
  if (!files) {
    throw new Error(`no pre-existing-app expectations for framework "${framework}"`);
  }

  test(`scaffolded pages carry the widget posture in a pre-existing ${framework} app`, async () => {
    const appDir = requiredEnv("JOURNEY_APP_DIR");

    for (const relPath of files.authPages) {
      const page = await readFile(join(appDir, relPath), "utf8");
      expect(page, `${relPath} is a managed file`).toContain(MANAGED_MARKER);
      expect(page, `${relPath} pins the widget variant`).toContain('variant="widget"');
      expect(page, `${relPath} follows the host color scheme`).toContain('theme="auto"');
    }

    // The manifest records the posture so doctor --fix restores widget pages,
    // and the hinge that derived it: setup did not scaffold this app.
    const state = JSON.parse(await readFile(join(appDir, ".zitadel/state.json"), "utf8")) as {
      scaffold?: {
        posture?: string;
        scaffolded_framework?: boolean;
        files?: Record<string, unknown>;
      };
    };
    expect(state.scaffold?.posture).toBe("widget");
    expect(state.scaffold?.scaffolded_framework).toBeFalsy();
    // The host homepage and shell are user-owned: never recorded as managed.
    expect(state.scaffold?.files ?? {}).not.toHaveProperty([files.homepage]);
    expect(state.scaffold?.files ?? {}).not.toHaveProperty([files.shell]);
  });

  test(`the host app's homepage and shell survive setup in a pre-existing ${framework} app`, async () => {
    const appDir = requiredEnv("JOURNEY_APP_DIR");

    const homepage = await readFile(join(appDir, files.homepage), "utf8");
    expect(homepage).toContain("Welcome to Orbit Notes");
    expect(homepage).not.toContain(MANAGED_MARKER);

    const shell = await readFile(join(appDir, files.shell), "utf8");
    expect(shell).toContain("Orbit Notes");
    expect(shell).not.toContain(MANAGED_MARKER);
  });

  test(`the auth widgets render inside the host shell of a pre-existing ${framework} app`, async ({
    page,
  }) => {
    // A fresh scaffold's homepage redirects to /login; the pre-existing app
    // keeps its own landing page.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to Orbit Notes" })).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(page.url()).pathname).toBe("/");

    // On /login the host chrome stays (widget posture embeds the card in the
    // host layout instead of painting full-page chrome over it), and the
    // widget itself carries the posture end to end. `variant` reflects to an
    // attribute (the component styles off it); `theme` does not reflect, and
    // React 19 delivers it as a JS property — so assert it property-side.
    for (const path of ["/login", "/register"]) {
      await page.goto(path);
      await expect(page.getByRole("banner").getByText("Orbit Notes")).toBeVisible({
        timeout: 30_000,
      });
      const widget = page.locator('zitadel-login[variant="widget"]');
      await expect(widget).toBeVisible({ timeout: 30_000 });
      expect(await widget.evaluate((el) => (el as HTMLElement & { theme?: string }).theme)).toBe(
        "auto",
      );
    }
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
