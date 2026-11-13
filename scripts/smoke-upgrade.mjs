#!/usr/bin/env node
// Upgrades a data dir that the latest published release wrote:
//
// 1. installs @zitadel/server@<from> (default: npm's `latest`) from npm and
//    starts its binary on an empty data dir (SQLite, the default);
// 2. creates a project and a user in it over the API, then stops it;
// 3. runs `migrate` with the current build on that data dir and checks that
//    it applied the migrations the release does not have;
// 4. starts the current build and reads the user back with the project
//    secret the release issued.
//
//   node scripts/smoke-upgrade.mjs [--from <version>] [--binary <path>]
//
// The current build is dist/server/nextgen, which `@zitadel/server#build`
// writes; `turbo run //#smoke-upgrade` builds it first. The nightly
// artifacts workflow (.github/workflows/artifacts.yml) runs that task.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { isDirectRun, run, runCapture } from "./dev-process.mjs";
import { runServerCommand, startServer } from "./smoke-server.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_APPLIED_LOG = "database migrations applied";

/** The published release's binary for this host, installed from npm into dir. */
async function installRelease(version, dir) {
  await run(
    "npm",
    [
      "install",
      "--prefix",
      dir,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `@zitadel/server@${version}`,
    ],
    { cwd: dir },
  );
  const binary = process.platform === "win32" ? "nextgen.exe" : "nextgen";
  return join(
    dir,
    "node_modules",
    "@zitadel",
    `server-${process.platform}-${process.arch}`,
    "bin",
    binary,
  );
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

export async function smokeUpgrade({ from, binary = join(repoRoot, "dist/server/nextgen") } = {}) {
  const work = mkdtempSync(join(tmpdir(), "nextgen-upgrade-"));
  const dataDir = join(work, "data");
  try {
    const version =
      from ??
      (
        await runCapture("npm", ["view", "@zitadel/server", "version"], { cwd: work })
      ).stdout.trim();
    const releaseBinary = await installRelease(version, work);

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
    return { version, releaseSchema, currentSchema, projectId: project.id, userId: user.id };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { from: { type: "string" }, binary: { type: "string" } },
    });
    const result = await smokeUpgrade({
      from: values.from,
      ...(values.binary ? { binary: resolve(values.binary) } : {}),
    });
    process.stderr.write(
      `[smoke-upgrade] @zitadel/server@${result.version} wrote schema ${result.releaseSchema}; ` +
        `the current build migrated it to ${result.currentSchema} and read back user ${result.userId}\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
