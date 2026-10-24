import { expect, test } from "@playwright/test";

/**
 * How the repo-root vercel.json routes the console's paths on one origin: the
 * console service at /console/, the server's runtime document under that
 * path, and the old /ui/console links sent on. A wrong rule shows here by
 * name, where the browser test (console.browser.spec.ts) only times out on a
 * blank page. It also holds the Mixpanel proxy the CLI's usage analytics and
 * the server's service ping go through, which no other suite reaches.
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
