import { appendFile, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startLocalZitadel, type LocalZitadel } from "@zitadel/testing";
import type { TestProject } from "vitest/node";

import { Baseline, BaselineUpdate } from "./src/baseline";
import { Credentials } from "./src/credentials";
import { Lane, type FamilyRun } from "./src/lane";
import { Schemathesis } from "./src/schemathesis";
import { OpenApiSpec } from "./src/spec";
import { ContractSummary } from "./src/summary";

/**
 * Where the resource API lives on a deployment's host (ADR 077). The served
 * spec states it as its `servers` URL; the lane asserts the two agree, as the
 * Go side does for its own copy of this constant.
 */
const API_PREFIX = "/api/v1";

const workspaceRoot = join(import.meta.dirname, "..", "..");

declare module "vitest" {
  export interface ProvidedContext {
    contractRuns: FamilyRun[];
  }
}

/**
 * Puts the verdict where a person looks first: a file beside the raw reports,
 * the job summary and error annotations when run by GitHub Actions.
 */
async function publish(summary: ContractSummary): Promise<void> {
  const page = summary.markdown();
  const directory = join(import.meta.dirname, "test-output");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "summary.md"), page);
  console.info(`\n${page}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${page}\n`);
  }
  if (process.env.GITHUB_ACTIONS) {
    for (const line of summary.annotations()) {
      console.info(line);
    }
  }
}

/**
 * Boots a real instance of this working tree's server, fetches the spec it
 * serves, and runs Schemathesis against it once for each family of operations.
 * Testing the spec the binary serves, and not the YAML beside it, is the point:
 * it is the contract a customer's client reads, and it cannot drift from the
 * server under test.
 */
export default async function setup({ provide }: TestProject): Promise<() => Promise<void>> {
  const workDir = await mkdtemp(join(tmpdir(), "api-contract-"));
  // Schemathesis's container user must be able to reach the folders below it.
  await chmod(workDir, 0o755);
  console.info("[api-contract] booting an instance");
  let zitadel: LocalZitadel;
  try {
    zitadel = await startLocalZitadel({
      serverBinary:
        process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
    });
  } catch (error) {
    await rm(workDir, { recursive: true, force: true });
    throw error;
  }

  const teardown = async (): Promise<void> => {
    try {
      await zitadel.stop();
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };

  try {
    const baseUrl = `${zitadel.handle.baseUrl.replace(/\/$/, "")}${API_PREFIX}`;
    const response = await fetch(`${baseUrl}/openapi.json`);
    if (!response.ok) {
      throw new Error(`GET ${baseUrl}/openapi.json answered ${String(response.status)}`);
    }
    const specText = await response.text();
    const spec = OpenApiSpec.parse(specText);
    if (spec.prefix !== API_PREFIX) {
      throw new Error(`the served spec's servers URL is ${String(spec.prefix)}, not ${API_PREFIX}`);
    }

    const runs = await new Lane({
      spec,
      specText,
      baseUrl,
      credentials: new Credentials(zitadel, spec, baseUrl),
      runner: new Schemathesis(),
      workDir,
      artifactsDir: join(import.meta.dirname, "test-output", "schemathesis"),
      log: (message) => {
        console.info(`[api-contract] ${message}`);
      },
    }).run();

    if (process.env.API_CONTRACT_UPDATE_BASELINE === "1") {
      new BaselineUpdate(runs).apply(
        new Baseline(join(import.meta.dirname, "known-failures.json")),
      );
    }

    await publish(
      new ContractSummary(runs, new Baseline(join(import.meta.dirname, "known-failures.json"))),
    );
    provide("contractRuns", runs);
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}
