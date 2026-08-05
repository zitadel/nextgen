/* oxlint-disable playwright/expect-expect */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { prepareApp } from "./prepare-app.mjs";

test("prepares the customer local setup journey in the app root", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-journey-prepare-test-"));
  const calls = [];
  const registryUrl = "http://127.0.0.1:4873";
  const image = "ghcr.io/zitadel/nextgen:test";

  try {
    const metadata = await prepareApp({
      env: {
        JOURNEY_APP_URL: "http://localhost:3010",
        JOURNEY_CLI_PACKAGE: "@zitadel/cli",
        JOURNEY_FRAMEWORK: "react",
        JOURNEY_REGISTRY_URL: registryUrl,
        JOURNEY_SDK_PACKAGE: "@zitadel/sdk-react",
        JOURNEY_WORK_DIR: workDir,
        JOURNEY_ZITADEL_PORT: "18080",
        ZITADEL_LOCAL_IMAGE: image,
      },
      logMetadata: false,
      runCapture: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd, env: options.env });
        if (args.includes("setup")) {
          await writeGeneratedApp(options.cwd, registryUrl, "@zitadel/sdk-react");
        }
        if (args.includes("start")) {
          await mkdir(join(options.cwd, ".zitadel/local"), { recursive: true });
          await writeFile(
            join(options.cwd, ".zitadel/local/runtime.json"),
            `${JSON.stringify({ server_url: "http://localhost:18080" })}\n`,
          );
        }
        return {
          code: 0,
          stdout: `${JSON.stringify(okEnvelope(args))}\n`,
          stderr: "",
        };
      },
    });

    const appDir = join(workDir, "myapp");
    assert.equal(metadata.appDir, appDir);
    assert.equal(metadata.framework, "react");
    assert.equal(metadata.sdkPackage, "@zitadel/sdk-react");
    assert.equal(metadata.localRuntimeUrl, "http://localhost:18080");
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        [
          "--yes",
          "@zitadel/cli@alpha",
          "doctor",
          "--port",
          "18080",
          "--runtime",
          "binary",
          "--cwd",
          appDir,
          "--non-interactive",
          "--json",
        ],
        [
          "--yes",
          "@zitadel/cli@alpha",
          "start",
          "--port",
          "18080",
          "--runtime",
          "binary",
          "--cwd",
          appDir,
          "--non-interactive",
          "--json",
        ],
        [
          "--yes",
          "@zitadel/cli@alpha",
          "setup",
          "--framework",
          "react",
          "--server",
          "local",
          "--dev-port",
          "3010",
          "--cwd",
          appDir,
          "--non-interactive",
          "--json",
        ],
      ],
    );
    assert.deepEqual(calls.map((call) => call.cwd), [appDir, appDir, appDir]);
    assert.ok(calls.every((call) => call.env.ZITADEL_LOCAL_IMAGE === image));
    assert.ok(calls.every((call) => call.env.npm_config_cache === join(workDir, ".npm-cache")));
    assert.ok(calls.every((call) => call.env.npm_config_tmp === join(workDir, ".npm-tmp")));
    assert.ok(JSON.parse(await readFile(join(workDir, "doctor.json"), "utf8")));
    assert.ok(JSON.parse(await readFile(join(workDir, "start.json"), "utf8")));
    assert.ok(JSON.parse(await readFile(join(workDir, "setup.json"), "utf8")));
    assert.ok(JSON.parse(await readFile(join(workDir, "metadata.json"), "utf8")));
    await assert.rejects(readFile(join(appDir, "myapp/package.json"), "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("collects local runtime logs when a CLI step fails", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-journey-prepare-fail-test-"));
  const calls = [];

  try {
    await assert.rejects(
      prepareApp({
        env: {
          JOURNEY_CLI_PACKAGE: "@zitadel/cli",
          JOURNEY_SDK_PACKAGE: "@zitadel/sdk-next",
          JOURNEY_WORK_DIR: workDir,
        },
        logMetadata: false,
        runCapture: async (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          if (args.includes("doctor")) {
            return { code: 0, stdout: `${JSON.stringify(okEnvelope(args))}\n`, stderr: "" };
          }
          if (args.includes("start")) {
            return {
              code: 1,
              stdout: `${JSON.stringify({ status: "error", message: "boom" })}\n`,
              stderr: "start failed",
            };
          }
          if (args.includes("logs")) {
            return {
              code: 0,
              stdout: `${JSON.stringify({ status: "ok", data: { logs: "runtime log" } })}\n`,
              stderr: "",
            };
          }
          throw new Error(`unexpected command: ${args.join(" ")}`);
        },
      }),
      /start exited 1/,
    );

    assert.ok(calls.some((call) => call.args.includes("logs")));
    const logsCall = calls.find((call) => call.args.includes("logs"));
    assert.ok(logsCall.args.includes("--cwd"));
    assert.equal(logsCall.args[logsCall.args.indexOf("--cwd") + 1], join(workDir, "myapp"));
    assert.equal(logsCall.cwd, join(workDir, "myapp"));
    const logs = JSON.parse(await readFile(join(workDir, "logs.json"), "utf8"));
    assert.equal(logs.data.logs, "runtime log");
    const start = JSON.parse(await readFile(join(workDir, "start.json"), "utf8"));
    assert.equal(start.status, "error");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("passes the sign-in preset through to setup and records it", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-journey-prepare-preset-test-"));
  const calls = [];
  const registryUrl = "http://127.0.0.1:4873";

  try {
    const metadata = await prepareApp({
      env: {
        JOURNEY_APP_URL: "http://localhost:3010",
        JOURNEY_CLI_PACKAGE: "@zitadel/cli",
        JOURNEY_FRAMEWORK: "next",
        JOURNEY_PRESET: "passkey-first",
        JOURNEY_REGISTRY_URL: registryUrl,
        JOURNEY_SDK_PACKAGE: "@zitadel/sdk-next",
        JOURNEY_WORK_DIR: workDir,
      },
      logMetadata: false,
      runCapture: async (command, args, options) => {
        calls.push({ command, args });
        if (args.includes("setup")) {
          await writeGeneratedApp(options.cwd, registryUrl, "@zitadel/sdk-next");
          await writeBoundaryFile(options.cwd);
        }
        // The Next suite runs the managed-file drift probe after setup:
        // the doctor call against the deleted boundary must fail, and
        // `doctor --fix` must restore the file before the probe re-reads it.
        if (args.includes("doctor") && !args.includes("--fix")) {
          const boundaryExists = await fileExists(join(options.cwd, "proxy.ts"));
          if (!boundaryExists && calls.some((call) => call.args.includes("setup"))) {
            return {
              code: 3,
              stdout: `${JSON.stringify(driftEnvelope())}\n`,
              stderr: "",
            };
          }
        }
        if (args.includes("doctor") && args.includes("--fix")) {
          await writeBoundaryFile(options.cwd);
        }
        return {
          code: 0,
          stdout: `${JSON.stringify(okEnvelope(args))}\n`,
          stderr: "",
        };
      },
    });

    const setupCall = calls.find((call) => call.args.includes("setup"));
    assert.ok(setupCall, "setup step ran");
    assert.equal(setupCall.args[setupCall.args.indexOf("--preset") + 1], "passkey-first");
    assert.equal(metadata.preset, "passkey-first");

    const doctorCall = calls.find((call) => call.args.includes("doctor"));
    assert.ok(!doctorCall.args.includes("--preset"), "only setup takes the preset");

    // The drift probe ran: a failing doctor snapshot, a --fix invocation,
    // and the restored boundary file.
    const drift = JSON.parse(await readFile(join(workDir, "doctor-drift.json"), "utf8"));
    assert.equal(drift.status, "error");
    const fixCall = calls.find((call) => call.args.includes("--fix"));
    assert.ok(fixCall, "doctor --fix step ran");
    assert.ok(JSON.parse(await readFile(join(workDir, "doctor-fix.json"), "utf8")));
    const boundary = await readFile(join(workDir, "myapp", "proxy.ts"), "utf8");
    assert.ok(boundary.includes("zitadel-cli: managed-file"));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("accepts generated apps that use pnpm lockfiles", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-journey-prepare-pnpm-test-"));
  const registryUrl = "http://127.0.0.1:4873";

  try {
    const metadata = await prepareApp({
      env: {
        JOURNEY_APP_URL: "http://localhost:3010",
        JOURNEY_CLI_PACKAGE: "@zitadel/cli",
        JOURNEY_FRAMEWORK: "angular",
        JOURNEY_REGISTRY_URL: registryUrl,
        JOURNEY_SDK_PACKAGE: "@zitadel/sdk-angular",
        JOURNEY_WORK_DIR: workDir,
      },
      logMetadata: false,
      runCapture: async (_command, args, options) => {
        if (args.includes("setup")) {
          await writeGeneratedApp(options.cwd, registryUrl, "@zitadel/sdk-angular", "pnpm");
        }
        return {
          code: 0,
          stdout: `${JSON.stringify(okEnvelope(args))}\n`,
          stderr: "",
        };
      },
    });

    assert.equal(metadata.framework, "angular");
    assert.equal(metadata.sdkPackage, "@zitadel/sdk-angular");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("records log collection failures thrown as non-Error values", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zitadel-journey-prepare-non-error-test-"));

  try {
    await assert.rejects(
      prepareApp({
        env: {
          JOURNEY_CLI_PACKAGE: "@zitadel/cli",
          JOURNEY_SDK_PACKAGE: "@zitadel/sdk-next",
          JOURNEY_WORK_DIR: workDir,
        },
        logMetadata: false,
        runCapture: async (command, args) => {
          if (args.includes("doctor")) {
            return { code: 0, stdout: `${JSON.stringify(okEnvelope(args))}\n`, stderr: "" };
          }
          if (args.includes("start")) {
            return {
              code: 1,
              stdout: `${JSON.stringify({ status: "error", message: "boom" })}\n`,
              stderr: "start failed",
            };
          }
          if (args.includes("logs")) {
            throw null;
          }
          throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
        },
      }),
      /start exited 1/,
    );

    assert.equal(
      await readFile(join(workDir, "logs.stderr.log"), "utf8"),
      "failed to collect local runtime logs: null\n",
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

async function writeGeneratedApp(appDir, registryUrl, sdkPackage, lockfile = "npm") {
  await writeFile(
    join(appDir, "package.json"),
    `${JSON.stringify({ dependencies: { [sdkPackage]: "alpha" } }, null, 2)}\n`,
  );
  if (lockfile === "pnpm") {
    await writeFile(
      join(appDir, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "  .:",
        "    dependencies:",
        `      ${sdkPackage}:`,
        "        specifier: alpha",
        "        version: 0.1.0-alpha.5",
        "",
        "packages:",
        `  ${sdkPackage}@0.1.0-alpha.5:`,
        `    resolution: {tarball: ${registryUrl}/${sdkPackage}/-/package.tgz}`,
        "",
      ].join("\n"),
    );
    return;
  }
  await writeFile(
    join(appDir, "package-lock.json"),
    `${JSON.stringify(
      {
        packages: {
          [`node_modules/${sdkPackage}`]: {
            resolved: `${registryUrl}/${sdkPackage}/-/${sdkPackage.split("/").at(-1)}.tgz`,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

function okEnvelope(args) {
  const command = args[2];
  const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : "8080";
  if (command === "start") {
    return { status: "ok", data: { urls: { api: `http://localhost:${port}` } } };
  }
  if (command === "setup") {
    return { status: "ok", data: { server: `http://localhost:${port}` } };
  }
  return { status: "ok", data: { ok: true } };
}

/** The doctor failure envelope the drift probe expects for a deleted boundary. */
function driftEnvelope() {
  return {
    status: "error",
    code: "E_VALIDATION",
    message: "1 of 10 checks failed",
    details: {
      checks: [{ name: "managed-files", status: "fail", message: "missing scaffolded infrastructure file(s): proxy.ts" }],
    },
  };
}

async function writeBoundaryFile(appDir) {
  await writeFile(
    join(appDir, "proxy.ts"),
    "// zitadel-cli: managed-file v1\nexport function proxy() {}\n",
  );
}

async function fileExists(path) {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
