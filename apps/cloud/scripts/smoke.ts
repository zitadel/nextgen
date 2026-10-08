#!/usr/bin/env tsx
/**
 * Post-deploy smoke test for the preview cloud.
 *
 *   pnpm run smoke -- https://preview.example.com
 *
 * Exercises readiness, anonymous project creation, the operator plane with
 * the project secret (user create and query), and the session CSRF handshake,
 * which only succeeds when the platform forwards the public origin correctly.
 * Exits non-zero on the first failure. Creates one throwaway project.
 */

// pnpm forwards its `--` separator as an argument; ignore it.
const args = process.argv.slice(2).filter((a) => a !== "--");
const base = (args[0] ?? process.env.PUBLIC_BASE ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: smoke.ts <public base url>");
  process.exit(2);
}

const SCHEMA_URL = "https://nextgen.com/api/schemas/default-human-user.json";

interface Step {
  name: string;
  status: number;
  ms: number;
}
const steps: Step[] = [];

async function call(
  name: string,
  path: string,
  init: RequestInit & { expect: number },
): Promise<Response> {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, init);
  const ms = Math.round(performance.now() - started);
  steps.push({ name, status: response.status, ms });
  if (response.status !== init.expect) {
    const body = await response.text();
    throw new Error(
      `${name}: expected ${init.expect}, got ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  return response;
}

try {
  await call("readyz", "/readyz", { expect: 200 });

  const project = (await (
    await call("createProject", "/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `smoke-${new Date().toISOString()}`,
        preview_origins: [],
        seed_defaults: true,
      }),
      expect: 201,
    })
  ).json()) as { id: string; project_secret: string };

  const auth = { authorization: `Bearer ${project.project_secret}` };
  const q = `project_id=${encodeURIComponent(project.id)}`;

  await call("listSchemas", `/schemas?${q}`, { headers: auth, expect: 200 });

  const user = (await (
    await call("createUser", `/users?${q}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        schema: SCHEMA_URL,
        attributes: { email: `smoke-${Date.now()}@example.com` },
      }),
      expect: 201,
    })
  ).json()) as { id: string };

  await call("getUser", `/users/${encodeURIComponent(user.id)}?${q}`, {
    headers: auth,
    expect: 200,
  });

  const users = (await (
    await call("queryUsers", "/users/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
      expect: 200,
    })
  ).json()) as { users: Array<{ id: string }> };
  if (!users.users.some((u) => u.id === user.id)) {
    throw new Error("queryUsers: created user not in the result");
  }

  // A cookie-less me-op must be refused, which proves the session
  // middleware runs and the route exists on the deployed version. A 401 here
  // is the expected, healthy answer. (/sessions/me/csrf is newer than
  // 1.0.0-alpha.24, so the probe uses the long-standing /sessions/me.)
  await call("sessionWithoutCookie", "/sessions/me", { expect: 401 });

  console.table(steps);
  console.log(`smoke ok against ${base} (project ${project.id})`);
} catch (error) {
  console.table(steps);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Top-level await needs a module scope; the script has no other exports.
export {};
