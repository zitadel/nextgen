import { appendFile, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TestProject } from "vitest/node";

import { Baseline, BaselineUpdate } from "./src/baseline";
import { API_PREFIX, LocalInstances } from "./src/instances";
import { Lane, type FamilyRun } from "./src/lane";
import { Schemathesis } from "./src/schemathesis";
import { OpenApiSpec } from "./src/spec";
import { ContractSummary } from "./src/summary";

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
 * Boots a real instance of this working tree's server to fetch the spec it
 * serves, then runs Schemathesis against it once for each family of
 * operations, every container on an instance of its own. Testing the spec the
 * binary serves, and not the YAML beside it, is the point: it is the contract a
 * customer's client reads, and it cannot drift from the server under test.
 */
export default async function setup({ provide }: TestProject): Promise<() => Promise<void>> {
  const workDir = await mkdtemp(join(tmpdir(), "api-contract-"));
  // Schemathesis's container user must be able to reach the folders below it.
  await chmod(workDir, 0o755);
  const teardown = async (): Promise<void> => {
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    console.info("[api-contract] booting an instance to read the spec");
    const instances = new LocalInstances(
      process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
    );
    const probe = await instances.start();
    let specText: string;
    try {
      const response = await fetch(`${probe.baseUrl}/openapi.json`);
      if (!response.ok) {
        throw new Error(`GET ${probe.baseUrl}/openapi.json answered ${String(response.status)}`);
      }
      specText = await response.text();
    } finally {
      await probe.stop();
    }
    const spec = OpenApiSpec.parse(specText);
    if (spec.prefix !== API_PREFIX) {
      throw new Error(`the served spec's servers URL is ${String(spec.prefix)}, not ${API_PREFIX}`);
    }
    instances.useSpec(spec);

    const runs = await new Lane({
      spec,
      specText,
      instances,
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
