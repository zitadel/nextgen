/**
 * The console's real-data dev loop: one command that boots a real Zitadel,
 * seeds it, and starts Vite against it.
 *
 * The console manages an instance, so its screens are only honest against a
 * real backend — `@zitadel/api-mock` has no user store, so a users list read
 * from it is a fiction. This script boots the packaged server (binary runtime +
 * SQLite by default, no Docker) via `@zitadel/testing`, bootstraps a project
 * with the default schema and login flow, seeds users, and then starts
 * `console:dev` with the dev proxy pointed at that instance:
 *
 *   CONSOLE_BACKEND_URL     -> the booted instance
 *   CONSOLE_PROJECT_SECRET  -> the operator credential the proxy injects, which
 *                              is what authorizes `listUsers` (`user.read`);
 *                              the browser-plane publishable key deliberately
 *                              cannot list users (`internal/api/user.go`)
 *   VITE_CONSOLE_PROJECT_ID -> pins the client to the bootstrapped project, so
 *                              it agrees with the secret above
 *
 * The instance is ephemeral: each run gets a fresh database and re-seeds, so
 * the users list looks identical every time (good for design work) at the cost
 * of signing in again after a restart. Persisting the instance across runs is
 * deliberately out of scope here — it needs the project secret stored between
 * runs and existing-state detection.
 *
 * `--seed-only` boots, seeds, prints the handle, and exits without Vite, for
 * pointing a separately-running console (or curl) at a fresh instance.
 */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalZitadel, type LocalZitadel, type SeededUser } from "@zitadel/testing";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appDir, "../..");

const consoleOrigin = process.env.CONSOLE_DEV_ORIGIN ?? "http://localhost:5174";
const port = Number(process.env.CONSOLE_DEV_ZITADEL_PORT ?? 8094);
const configuredServerBinary = process.env.ZITADEL_SERVER_BINARY;
const serverBinary =
  configuredServerBinary || join(workspaceRoot, "dist", "server", "nextgen");
const seedOnly = process.argv.includes("--seed-only");

/**
 * The account you sign in as. Fixed rather than random so the credentials stay
 * the same across restarts and can live in a password manager.
 */
const DEV_USER = {
  email: process.env.CONSOLE_DEV_EMAIL ?? "dev@zitadel.local",
  password: process.env.CONSOLE_DEV_PASSWORD ?? "Console-dev-1",
} as const;

/**
 * Extra users so list screens have something to page, sort, and filter. Names
 * are stable so a screenshot diff between runs reflects code changes, not
 * reshuffled fixture data.
 *
 * `givenName`/`familyName` need the `consumer` use case below — the shipped
 * `minimal` schema is email-only and would reject them.
 */
const EXTRA_USERS: ReadonlyArray<{ email: string; givenName: string; familyName: string }> = [
  { email: "ada.lovelace@example.com", givenName: "Ada", familyName: "Lovelace" },
  { email: "alan.turing@example.com", givenName: "Alan", familyName: "Turing" },
  { email: "grace.hopper@example.com", givenName: "Grace", familyName: "Hopper" },
  { email: "katherine.johnson@example.com", givenName: "Katherine", familyName: "Johnson" },
  { email: "linus.torvalds@example.com", givenName: "Linus", familyName: "Torvalds" },
  { email: "margaret.hamilton@example.com", givenName: "Margaret", familyName: "Hamilton" },
  { email: "radia.perlman@example.com", givenName: "Radia", familyName: "Perlman" },
  { email: "barbara.liskov@example.com", givenName: "Barbara", familyName: "Liskov" },
];

if (configuredServerBinary) {
  await access(serverBinary).catch(() => {
    console.error(`[console-dev-real] server binary not found at ${serverBinary}`);
    process.exit(1);
  });
} else {
  // Build (or cache-hit) the embedded server binary. Spawned here instead of
  // declared as a task dep: server:build depends on console:build, so a
  // dev-real -> server:build task dep would cycle the project graph.
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const build = spawn("moon", ["run", "server:build"], {
      cwd: workspaceRoot,
      stdio: "inherit",
    });
    build.on("error", rejectBuild);
    build.on("close", (code, signal) => {
      if (code === 0) {
        resolveBuild();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit ${code}`;
      rejectBuild(new Error(`moon run server:build failed with ${detail}`));
    });
  });
}

// Signal handlers close over this before the asynchronous boot assigns it.
// oxlint-disable-next-line prefer-const
let zitadel: LocalZitadel | undefined;
let stopping: Promise<void> | undefined;

function shutdown(code: number): Promise<void> {
  stopping ??= (async () => {
    try {
      await zitadel?.stop();
    } catch (error) {
      console.error(`[console-dev-real] stop failed: ${(error as Error).message}`);
      code = 1;
    }
    process.exit(code);
  })();
  return stopping;
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown(0));
}

console.log(`[console-dev-real] booting a real instance on port ${port} …`);
zitadel = await startLocalZitadel({
  port,
  // The backend's origin check rejects forwarded requests from unregistered
  // origins, and the Vite dev server is the origin the browser will use.
  appOrigins: [consoleOrigin],
  serverBinary,
  projectName: "console-dev",
  // `consumer` widens the user schema to email + givenName + familyName, so
  // seeded users carry real names instead of an email-only stub.
  useCase: "consumer",
});

const seeded: SeededUser[] = [];
try {
  seeded.push(await zitadel.seedUser(DEV_USER));
  seeded.push(
    ...(await zitadel.seedUsers(EXTRA_USERS.length, {
      email: (index) => EXTRA_USERS[index]!.email,
      attributes: (index) => {
        const { email: _email, ...attributes } = EXTRA_USERS[index]!;
        return attributes;
      },
    })),
  );
} catch (error) {
  console.error(`[console-dev-real] seeding failed: ${(error as Error).message}`);
  await shutdown(1);
}

const { baseUrl, projectId, projectSecret } = zitadel.handle;
console.log(
  [
    "",
    "  ┌─ console dev (real backend) ──────────────────────────────",
    `  │  instance   ${baseUrl}`,
    `  │  project    ${projectId}`,
    `  │  users      ${seeded.length} seeded`,
    "  │",
    `  │  sign in at ${consoleOrigin}/login`,
    `  │    email     ${DEV_USER.email}`,
    `  │    password  ${DEV_USER.password}`,
    "  └───────────────────────────────────────────────────────────",
    "",
  ].join("\n"),
);

if (seedOnly) {
  console.log("[console-dev-real] --seed-only: instance stays up, Ctrl-C to stop.");
  setInterval(() => {
    /* keep the event loop alive */
  }, 60_000);
} else {
  const vite = spawn("corepack", ["pnpm", "--filter", "@zitadel/console", "dev"], {
    cwd: workspaceRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      CONSOLE_BACKEND_URL: baseUrl,
      CONSOLE_PROJECT_SECRET: projectSecret,
      VITE_CONSOLE_PROJECT_ID: projectId,
    },
  });
  vite.on("exit", (code) => void shutdown(code ?? 0));
}
