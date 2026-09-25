/**
 * Adds a second project to a running `console:dev-real` instance and grants the
 * dev account access to it, so screens that list what a person can act on —
 * the project pill, Projects, each project's admins — have more than one project
 * to show.
 *
 * `dev-real` boots one project and signs the console into it. A second project
 * is one `POST /projects` away (unauthenticated; the server answers with the
 * new project's secret exactly once), and access is the same grant a
 * project's admins section creates: `POST /grants?project_id=<new>` with the
 * new project's secret, binding the dev user by id. The server allows a user homed in the
 * seeded project to be bound on another one because dev-real pins no platform
 * project (`internal/service/grant.go`, `resolvePrincipalHome`).
 *
 * The user id is read from `.dev-real/users.json`, which `dev-real` writes after
 * seeding (ids and emails only — the project secret never leaves `dev-real`).
 * So `dev-real` must be up:
 *
 *   moon run console:dev-real                              # terminal 1
 *   corepack pnpm --filter @zitadel/console exec tsx \
 *     scripts/dev-real-add-project.mts --name Beacon       # terminal 2
 *
 * Then reload the console. The instance is ephemeral, so the project is gone
 * with the next `dev-real` restart — rerun this to get it back.
 *
 * Options:
 *   --name <name>           project name (default: "Second project")
 *   --email <email>         the account to grant (default: CONSOLE_DEV_EMAIL
 *                           or dev@zitadel.local — the dev-real sign-in)
 *   --user-id <user_…>      grant this id instead of resolving --email
 *   --identifier <email>    send the address as a locator and let the server
 *                           resolve it — in the project the grant targets, or
 *                           in the platform project when one is pinned (claim
 *                           mode), which is where colleagues registered
 *                           through /login live and where the picker cannot
 *                           look (#1236 makes the dialog do the same)
 *   --relation <r>          viewer | editor | admin (default: admin)
 *   --project-id <proj_…>   grant on an existing project instead of creating
 *   --secret <secret>       that project's secret (printed when this script
 *                           created it); required with --project-id. For the
 *                           seeded project, use the console's own Settings →
 *                           Admins instead: it grants with your session.
 *
 * Environment (all optional, same defaults as dev-real):
 *   CONSOLE_DEV_ORIGIN        console dev server, default http://localhost:5174
 *   CONSOLE_DEV_ZITADEL_PORT  the booted instance's port, default 8094
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const consoleOrigin = process.env.CONSOLE_DEV_ORIGIN ?? "http://localhost:5174";
const backendUrl = `http://localhost:${process.env.CONSOLE_DEV_ZITADEL_PORT ?? 8094}`;

/** Secrets of projects this run created, keyed by id — the server hands each out once. */
const createdSecrets = new Map<string, string>();

const args = readArgs();
const name = args.name ?? "Second project";
const email = args.email ?? process.env.CONSOLE_DEV_EMAIL ?? "dev@zitadel.local";
const relation = args.relation ?? "admin";
if (!["viewer", "editor", "admin"].includes(relation)) {
  fail(`--relation must be viewer, editor or admin, got ${relation}`);
}

const principal: Principal = args.identifier
  ? { identifier: args.identifier }
  : { user_id: args["user-id"] ?? (await resolveUserId(email)) };
if (args["project-id"] && !args.secret) {
  fail(
    "--project-id needs that project's --secret (for the seeded project, use Settings → Admins in the console)",
  );
}
const projectId = args["project-id"] ?? (await createProject(name));
if (args["project-id"] && args.secret) createdSecrets.set(projectId, args.secret);
await grant(projectId, principal, relation);
const grants = await readBack(projectId);

console.log(
  [
    "",
    "  ┌─ project added ─────────────────────────────────────────",
    `  │  project    ${projectId}${args["project-id"] ? "" : `  (${name})`}`,
    `  │  ${relation.padEnd(10)} ${"identifier" in principal ? principal.identifier : `${email}  (${principal.user_id})`}`,
    "  │",
    ...(createdSecrets.has(projectId) && !args.secret
      ? [`  │  secret     ${createdSecrets.get(projectId)}  (shown once; keep it for --secret)`]
      : []),
    "  │",
    `  │  grants on ${projectId} as the server lists them:`,
    ...grants.map((row) => `  │    ${JSON.stringify(row)}`),
    "  │",
    `  │  open   ${consoleOrigin}/projects/${projectId}`,
    "  └─────────────────────────────────────────────────────────",
    "",
  ].join("\n"),
);

/** The seeded accounts `dev-real` wrote after seeding (`scripts/dev-real.mts`). */
async function resolveUserId(identifier: string): Promise<string> {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".dev-real", "users.json");
  let users: Array<{ id: string; email: string }>;
  try {
    users = JSON.parse(await readFile(file, "utf8")) as Array<{ id: string; email: string }>;
  } catch {
    fail(`cannot read ${file} — is console:dev-real running? (pass --user-id to skip the lookup)`);
  }
  const user = users.find((candidate) => candidate.email === identifier);
  if (!user) {
    fail(
      `no seeded user ${identifier} among the ${users.length} dev-real wrote (pass --user-id to skip the lookup)`,
    );
  }
  return user.id;
}

/** Unauthenticated; the response carries the new project's secret exactly once. */
async function createProject(projectName: string): Promise<string> {
  const response = await request(`${backendUrl}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: projectName,
      preview_origins: [consoleOrigin],
      // The project only has to exist and be grantable; a schema and login flow
      // are what a project needs to sign users in, which this one never does.
      seed_defaults: false,
    }),
  });
  const project = (await response.json()) as { id: string; project_secret: string };
  createdSecrets.set(project.id, project.project_secret);
  return project.id;
}

/** The `user` locator `POST /grants` takes: by id, or by identifier for the server to resolve. */
type Principal = { user_id: string } | { identifier: string };

async function grant(targetProjectId: string, principal: Principal, rel: string): Promise<void> {
  const query = new URLSearchParams({ project_id: targetProjectId });
  await request(`${backendUrl}/grants?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretFor(targetProjectId)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ user: principal, relation: rel }),
  });
}

/** The secret of a project this run created, or the one --secret supplied. */
function secretFor(targetProjectId: string): string {
  const secret = createdSecrets.get(targetProjectId);
  if (!secret) fail(`no secret for ${targetProjectId}`);
  return secret;
}

/**
 * `POST /grants/query` on the project, read back so the run shows what the
 * server stored — the id, principal and relation the console will later look
 * for through `GET /users/me/projects`.
 */
async function readBack(targetProjectId: string): Promise<unknown[]> {
  const query = new URLSearchParams({ project_id: targetProjectId });
  const response = await request(`${backendUrl}/grants/query?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretFor(targetProjectId)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ limit: 100, expand: ["principal"] }),
  });
  const { grants } = (await response.json()) as { grants: unknown[] };
  return grants;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    fail(`${init.method} ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    fail(`${init.method} ${url} answered ${response.status}: ${await response.text()}`);
  }
  return response;
}

/** `node:util` parsing: rejects unknown flags and missing values, keeps a value's own `=`. */
function readArgs(): Partial<Record<string, string>> {
  try {
    return parseArgs({
      options: {
        name: { type: "string" },
        email: { type: "string" },
        "user-id": { type: "string" },
        identifier: { type: "string" },
        relation: { type: "string" },
        "project-id": { type: "string" },
        secret: { type: "string" },
      },
      strict: true,
    }).values;
  } catch (error) {
    fail((error as Error).message);
  }
}

function fail(message: string): never {
  console.error(`[dev-real-add-project] ${message}`);
  process.exit(1);
}
