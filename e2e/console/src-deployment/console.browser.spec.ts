import { expect, test } from "@playwright/test";

import { recordPolicyViolations } from "../support/policy";

/**
 * The console signed out, as the deployment serves it. A deep link proves the
 * console service's fallback to its index.html and the build's base (every
 * asset loads from /console/); the guard sends it to the sign-in screen; the
 * login widget asking for an email proves the server behind it, because the
 * widget takes its project from /console/runtime.json and starts its flow
 * with POST /flow on the same origin.
 */
test("a deep link lands on the sign-in screen, whose widget asks for an email", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const violations = await recordPolicyViolations(page);
  // Every response that failed, but the guard's GET /sessions/me, whose 401 is
  // what signed out looks like, and Vercel's analytics scripts, which no
  // contract here depends on.
  const failed: string[] = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (
      response.status() >= 400 &&
      pathname !== "/sessions/me" &&
      !pathname.startsWith("/_vercel/")
    ) {
      failed.push(`${response.status()} ${response.request().method()} ${pathname}`);
    }
  });

  try {
    await page.goto("/console/users");
    await expect(
      page.getByRole("heading", { name: "Sign in to the Zitadel console" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();

    const url = new URL(page.url());
    expect(url.pathname).toBe("/console/login");
    expect(url.searchParams.get("next")).toBe("/users");
  } finally {
    // Reported next to whatever failed above: on a blank page, the requests
    // that failed say why.
    expect.soft(failed, "requests that failed").toEqual([]);
    expect.soft(errors, "uncaught errors").toEqual([]);
    expect.soft(violations, "policy violations").toEqual([]);
  }
});
