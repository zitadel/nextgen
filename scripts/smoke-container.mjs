#!/usr/bin/env node
// Runs a built server image the way an operator would — no flags, no volumes,
// no --user override — and asserts it reaches the point where it serves.
//
// This is the only check that covers the whole container contract at once: the
// Dockerfile's data dir default, the declared non-root USER, and the server's
// own directory handling. CI has no Docker, so it is opt-in; the CI-enforced
// halves are TestDefaultServerDataDirHasNoSideEffects (cmd/server) and the
// Dockerfile parity assertion in the CLI's docker unit tests.
import { setTimeout as delay } from "node:timers/promises";

import { isDirectRun, run, runCapture } from "./dev-process.mjs";
import { LOCAL_RUNTIME_IMAGE } from "./build-local-runtime-image.mjs";

const READY_LOG = "structured logger configured";
const CONTAINER_NAME = "zitadel-nextgen-smoke";

export async function smokeContainer(options = {}) {
  const image = options.image ?? LOCAL_RUNTIME_IMAGE;
  const name = options.containerName ?? CONTAINER_NAME;
  const port = options.port ?? 28080;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const runFn = options.run ?? run;
  const runCaptureFn = options.runCapture ?? runCapture;

  await runFn("docker", ["rm", "--force", name], { stdio: "ignore" }).catch(() => {});
  // Deliberately minimal: any flag added here weakens what the check proves.
  await runFn("docker", [
    "run",
    "--detach",
    "--name",
    name,
    "--publish",
    `127.0.0.1:${port}:8080`,
    image,
  ]);

  try {
    const deadline = Date.now() + timeoutMs;
    let logs = "";
    while (Date.now() < deadline) {
      // The server logs to stderr, so both streams have to be considered.
      const captured = await runCaptureFn("docker", ["logs", name]).catch(() => null);
      logs = captured ? `${captured.stdout}${captured.stderr}` : "";
      if (logs.includes(READY_LOG)) break;
      const state = await runCaptureFn("docker", [
        "inspect",
        "-f",
        "{{.State.Running}}",
        name,
      ]).catch(() => ({ stdout: "false" }));
      if (state.stdout.trim() !== "true") {
        throw new Error(`container exited before serving:\n${logs}`);
      }
      await delay(1000);
    }
    if (!logs.includes(READY_LOG)) {
      throw new Error(`container never logged ${JSON.stringify(READY_LOG)}:\n${logs}`);
    }

    // Logging is not serving: probe the port the image exposes.
    let status = 0;
    while (Date.now() < deadline && status !== 200) {
      status = await fetch(`http://127.0.0.1:${port}/healthz`)
        .then((response) => response.status)
        .catch(() => 0);
      if (status !== 200) await delay(1000);
    }
    if (status !== 200) {
      throw new Error(`container logged readiness but /healthz returned ${status}`);
    }

    return { image, port, status };
  } finally {
    await runFn("docker", ["rm", "--force", name], { stdio: "ignore" }).catch(() => {});
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const result = await smokeContainer({ image: process.argv[2] });
    process.stderr.write(`[smoke-container] ${result.image} started as its default user\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
