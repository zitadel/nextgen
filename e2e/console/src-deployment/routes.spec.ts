import { expect, test } from "@playwright/test";

/**
 * How the repo-root vercel.json routes the console's paths on one origin: the
 * console service at /console/, the server's runtime document under that
 * path, and the old /ui/console links sent on. A wrong rule shows here by
 * name, where the browser test (console.browser.spec.ts) only times out on a
 * blank page. It also holds the API's prefix, the Mixpanel proxy the CLI's
 * usage analytics and the server's service ping go through, which no other
 * suite reaches, and what answers a path no service serves.
 */

test("the server answers /console/runtime.json, under the console's path", async ({ request }) => {
  const response = await request.get("/console/runtime.json");
  expect(response.status()).toBe(200);
  // The console service would answer its index.html instead.
  expect(response.headers()["content-type"]).toContain("application/json");
  // The project the console signs into and the key its login widget sends,
  // both public by design (cmd/server/console_runtime.go).
  expect(await response.json()).toMatchObject({
    mode: "standalone",
    console_project_id: expect.any(String),
    publishable_key: expect.any(String),
  });
});

test("/console and the old /ui/console links redirect, query kept", async ({ request }) => {
  const cases = [
    { from: "/console", status: 308, location: "/console/" },
    { from: "/ui/console", status: 307, location: "/console/" },
    { from: "/ui/console/", status: 307, location: "/console/" },
    // A claim link the server handed out before the move.
    {
      from: "/ui/console/claim?challenge_id=ch_probe",
      status: 307,
      location: "/console/claim?challenge_id=ch_probe",
    },
  ];

  const wrong: string[] = [];
  for (const { from, status, location } of cases) {
    const response = await request.get(from, { maxRedirects: 0 });
    const got = `${response.status()} ${response.headers().location ?? "(no location)"}`;
    if (got !== `${status} ${location}`) {
      wrong.push(`${from}: ${got}, want ${status} ${location}`);
    }
  }
  expect(wrong).toEqual([]);
});

test("/api/v1/* is the server's API, and its root paths say they are deprecated", async ({
  request,
}) => {
  // vercel.json sends /api/* to the server ahead of every other service
  // (ADR 077). Until 1.0.0 the server also answers the API's root paths,
  // through the catch-all, with a Deprecation header. Signed out, both
  // spellings refuse GET /users/me with the API's envelope.
  for (const route of ["/api/v1/users/me", "/users/me"]) {
    const response = await request.get(route, { headers: { accept: "application/json" } });
    expect(response.status(), route).toBe(401);
    expect(await response.json(), route).toMatchObject({ code: "auth.unauthorized" });
    const deprecation = response.headers().deprecation;
    if (route.startsWith("/api/v1/")) {
      expect(deprecation, route).toBeUndefined();
    } else {
      expect(deprecation, route).toMatch(/^@\d+$/);
      expect(response.headers().link, route).toContain('rel="deprecation"');
    }
  }
});

test("/telemetry/mixpanel/* reaches Mixpanel's EU API", async ({ request }) => {
  // The CLI's usage analytics and the service ping go here
  // (apps/cli/src/lib/telemetry/config.ts, internal/serviceping).
  // Without a token Mixpanel records nothing and says so; the server's
  // catch-all would answer with anything but this.
  const events = [{ event: "route_probe", properties: {} }];
  const response = await request.post("/telemetry/mixpanel/track?verbose=1", {
    form: { data: Buffer.from(JSON.stringify(events)).toString("base64") },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ error: "token, missing or empty", status: 0 });
});

// A path no service answers reaches the server: a browser gets its error page
// and a program its envelope, and both quote Vercel's ID for the request, the
// one Vercel's logs file it under (ADR 076). The response's x-vercel-id is no
// match for it on a protected preview, which answers through one more hop
// with an ID of its own that Vercel does not log, so the check asks only that
// the server quotes one of Vercel's IDs, not a req_ ID it minted.
test("a path no service answers: a page for a browser, the envelope for a program", async ({
  request,
}) => {
  const path = "/no-such-page-routes-spec";
  // Five characters, the Unix time in milliseconds, twelve hex digits.
  const vercelRequestID = /^[0-9a-z]{5}-\d{13}-[0-9a-f]{12}$/;

  const page = await request.get(path, { headers: { accept: "text/html" } });
  expect(page.status()).toBe(404);
  const pageID = page.headers()["x-request-id"];
  expect(pageID).toMatch(vercelRequestID);
  const html = await page.text();
  expect(html).toContain("<title>Page not found · Zitadel</title>");
  expect(html).toContain(`Request ID <code>${pageID}</code>`);

  const envelope = await request.get(path, { headers: { accept: "application/json" } });
  expect(envelope.status()).toBe(404);
  expect(envelope.headers()["x-request-id"]).toMatch(vercelRequestID);
  expect(await envelope.json()).toEqual({ code: "req.not_found", message: expect.any(String) });
});
