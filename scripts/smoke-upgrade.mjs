#!/usr/bin/env node
// Upgrades a data dir that an older published release wrote:
//
// 1. installs @zitadel/server@<from> from npm and starts its binary on an
//    empty data dir (SQLite, the default);
// 2. creates a project and a user in it over the API, then stops it;
// 3. runs `migrate` with the target on that data dir and checks that the
//    schema version did not go back;
// 4. starts the target and reads the user back with the project secret the
//    older release issued.
//
//   node scripts/smoke-upgrade.mjs [--from <version>] [--binary <path>]
//   node scripts/smoke-upgrade.mjs --to <version> [--from <version>]
//
// The target is the current build, dist/server/nextgen, which
// `@zitadel/server#build` writes (`turbo run //#smoke-upgrade` builds it
// first), and --from defaults to npm's `latest`. With --to the target is
// that published release, installed from npm, and --from defaults to the
// stable release published before it (by npm's publish time: version order
// is not release order, an old 1.0.0-alpha line sits above 0.x). An empty
// --to is the same as none. The artifacts workflow
// (.github/workflows/artifacts.yml) runs both forms.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { isDirectRun, runCapture } from "./dev-process.mjs";
import { installPublishedServer, runServerCommand, startServer } from "./smoke-server.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_APPLIED_LOG = "database migrations applied";

/**
 * The stable release published last before `version` (any release, if
 * `version` is a prerelease), by npm's publish times.
 */
export function previousRelease(version, times) {
  const published = times[version];
  if (!published) throw new Error(`@zitadel/server@${version} is not published`);
  const candidates = Object.entries(times).filter(
    ([candidate, time]) =>
      !["created", "modified"].includes(candidate) &&
      time < published &&
      (version.includes("-") || !candidate.includes("-")),
  );
  if (candidates.length === 0) throw new Error(`no release of @zitadel/server before ${version}`);
  return candidates.reduce((latest, entry) => (entry[1] > latest[1] ? entry : latest))[0];
}

async function npmView(field, cwd) {
  const { stdout } = await runCapture("npm", ["view", "@zitadel/server", field, "--json"], { cwd });
  return JSON.parse(stdout);
}

/** The newest goose version recorded in the data dir's SQLite database. */
function schemaVersion(dataDir) {
  const db = new DatabaseSync(join(dataDir, "zitadel.db"), { readOnly: true });
  try {
    return db
      .prepare("SELECT MAX(version_id) AS version FROM goose_db_version WHERE is_applied")
      .get().version;
  } finally {
    db.close();
  }
}

async function api(baseUrl, method, path, { body, token } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Project creation is rate-limited per client.
    if (response.status === 429 && attempt < 10) {
      await delay(1000);
      continue;
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }
}

export async function smokeUpgrade({
  from,
  to,
  binary = join(repoRoot, "dist/server/nextgen"),
} = {}) {
  const work = mkdtempSync(join(tmpdir(), "nextgen-upgrade-"));
  const dataDir = join(work, "data");
  try {
    let version = from;
    if (to) {
      version ??= previousRelease(to, await npmView("time", work));
      mkdirSync(join(work, "to"));
      binary = await installPublishedServer(to, join(work, "to"));
    }
    version ??= await npmView("version", work);
    mkdirSync(join(work, "from"));
    const releaseBinary = await installPublishedServer(version, join(work, "from"));

    // The release writes the data dir.
    const email = `upgrade-${Date.now()}@example.com`;
    const old = await startServer({ binary: releaseBinary, dataDir });
    let project;
    let user;
    try {
      project = await api(old.url, "POST", "/api/v1/projects", { body: { name: "upgrade-smoke" } });
      const token = project.project_secret;
      const { schemas } = await api(old.url, "GET", `/api/v1/schemas?project_id=${project.id}`, {
        token,
      });
      const schema = schemas.find((candidate) => candidate.schema?.objectType === "human-user");
      if (!schema) throw new Error(`release ${version} seeded no human user schema`);
      user = await api(old.url, "POST", `/api/v1/users?project_id=${project.id}`, {
        token,
        body: { schema: schema.id, attributes: { email } },
      });
    } finally {
      await old.stop();
    }
    const releaseSchema = schemaVersion(dataDir);

    // The current build migrates it...
    const migrate = await runServerCommand({ binary, dataDir, args: ["migrate"] });
    if (migrate.code !== 0 || !migrate.output.includes(MIGRATIONS_APPLIED_LOG)) {
      throw new Error(`${binary} migrate failed (code ${migrate.code}):\n${migrate.output}`);
    }
    const currentSchema = schemaVersion(dataDir);
    if (currentSchema < releaseSchema) {
      throw new Error(`schema went back from ${releaseSchema} to ${currentSchema}`);
    }

    // ...and serves what the release wrote, to the secret the release issued.
    const current = await startServer({ binary, dataDir });
    try {
      const read = await api(current.url, "GET", `/api/v1/users/${user.id}`, {
        token: project.project_secret,
      });
      if (read.id !== user.id || read.attributes?.email !== email) {
        throw new Error(`read back ${JSON.stringify(read)}, not user ${user.id} <${email}>`);
      }
    } finally {
      await current.stop();
    }
    return { version, to, releaseSchema, currentSchema, projectId: project.id, userId: user.id };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { from: { type: "string" }, to: { type: "string" }, binary: { type: "string" } },
    });
    const result = await smokeUpgrade({
      from: values.from || undefined,
      to: values.to || undefined,
      ...(values.binary ? { binary: resolve(values.binary) } : {}),
    });
    const target = result.to ? `@zitadel/server@${result.to}` : "the current build";
    process.stderr.write(
      `[smoke-upgrade] @zitadel/server@${result.version} wrote schema ${result.releaseSchema}; ` +
        `${target} migrated it to ${result.currentSchema} and read back user ${result.userId}\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
