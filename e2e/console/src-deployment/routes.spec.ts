import { expect, test } from "@playwright/test";

import { unlistedInlineScripts } from "../support/policy";

/**
 * How the repo-root vercel.json routes the console's paths on one origin: the
 * console service at /console/, the server's runtime document under that
 * path, and the old /ui/console links sent on. A wrong rule shows here by
 * name, where the browser test (console.browser.spec.ts) only times out on a
 * blank page. It also holds the Mixpanel proxy the CLI's usage analytics and
 * the server's service ping go through, which no other suite reaches, what
 * answers a path no service serves, and the security headers each service's
 * responses carry.
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

// The edge sets the same shared headers on every response, whichever service
// answers it, the Mixpanel proxy's too; only vercel.json's own redirects,
// which have no body, go without. A service that sets one as well sends the
// same value, so a header may arrive twice, never two ways.
test("every service's responses carry the security headers", async ({ request }) => {
  const paths = [
    "/", // website
    "/changelog",
    "/docs",
    "/docs/llms.txt",
    "/console/users", // console service
    "/console/runtime.json", // server
    "/sessions/me",
    "/no-such-page-routes-spec",
    "/schemas/v1/user-schema.json",
  ];
  const want = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };

  const wrong: string[] = [];
  for (const path of paths) {
    const response = await request.get(path, { maxRedirects: 0 });
    for (const [name, value] of Object.entries(want)) {
      const got = response.headers()[name];
      // An edge and service can repeat the same header. Permissions-Policy
      // itself is a comma-separated list, so compare whole repetitions.
      const expected = value.split(/,\s*/);
      const actual = got?.split(/,\s*/);
      if (
        !actual ||
        actual.length % expected.length !== 0 ||
        actual.some((each, index) => each !== expected[index % expected.length])
      ) {
        wrong.push(`${path}: ${name} ${got ?? "(none)"}, want ${value}`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

// Each service's pages carry an enforced policy that lets nothing frame them,
// beside the edge's X-Frame-Options.
test("no service's page may be framed", async ({ request }) => {
  const wrong: string[] = [];
  for (const path of ["/", "/changelog", "/docs", "/console/users", "/no-such-page-routes-spec"]) {
    const response = await request.get(path, { headers: { accept: "text/html" } });
    const policy = response.headers()["content-security-policy"] ?? "(none)";
    if (!policy.includes("frame-ancestors 'none'")) wrong.push(`${path}: ${policy}`);
  }
  expect(wrong).toEqual([]);
});

// The website's pages stay prerendered, so their enforced policy allows
// each page's inline scripts by hash (apps/website/csp-adapter.mjs) rather
// than all of them. The docs' own suite checks every docs page the same way.
test("the website's pages list a hash for each of their inline scripts", async ({ request }) => {
  const changelog = await request.get("/changelog", { headers: { accept: "text/html" } });
  const entry = (await changelog.text()).match(/href="(\/changelog\/[^"/]+)"/)?.[1];
  expect(entry, "a changelog entry's link").toBeDefined();
  const wrong: string[] = [];
  for (const path of ["/", "/changelog", entry ?? "", "/pricing"]) {
    const response = await request.get(path, { headers: { accept: "text/html" } });
    const policy = response.headers()["content-security-policy"] ?? "";
    const unlisted = unlistedInlineScripts(await response.text(), policy);
    if (response.status() !== 200 || unlisted.length) {
      wrong.push(`${path}: ${response.status()}, ${unlisted.length} inline scripts without a hash`);
    }
  }
  expect(wrong).toEqual([]);
});

// The console service's policies are the ones the server sends for the same
// page, plus Vercel's toolbar (internal/staticui/console holds vercel.json to
// them): enforced, its scripts from its own origin and its inline one by hash,
// and a stricter one reported on.
test("the console's page carries its policies", async ({ request }) => {
  const response = await request.get("/console/users");
  expect(response.status()).toBe(200);
  const enforced = response.headers()["content-security-policy"];
  expect(enforced).toMatch(/(^|; )script-src 'self' 'sha256-[A-Za-z0-9+/]+=*'( [^;]+)?(;|$)/);
  expect(enforced).toContain("frame-ancestors 'none'");
  expect(enforced).toContain("report-uri /csp-report");
  expect(response.headers()["content-security-policy-report-only"]).toContain("default-src 'self'");
});

// Where every page's policy sends its violations: the server's catch-all, ahead
// of the API, takes a browser's report without a session. The report names no
// violation, so the deployment logs none; the API would answer 404.
test("/csp-report takes a violation report", async ({ request }) => {
  const response = await request.post("/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({ "csp-report": {} }),
  });
  expect(response.status()).toBe(204);
});
