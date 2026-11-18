import { appendFile, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bootstrapProject,
  connectZitadel,
  startLocalZitadel,
  type ConnectedZitadel,
} from "@zitadel/testing";
import { test as base } from "vitest";

import { Baseline, BaselineUpdate } from "./baseline";
import { Contract, type CommandRun } from "./contract";
import { Credentials } from "./credentials";
import { Schemathesis } from "./schemathesis";
import { OperationSources, type SourceLocation } from "./sources";
import { OpenApiSpec } from "./spec";
import { ContractSummary } from "./summary";

const packageRoot = join(import.meta.dirname, "..");
const workspaceRoot = join(packageRoot, "..", "..");

/**
 * Where the resource API lives on a deployment's host (ADR 077). The served
 * spec states it as its `servers` URL; the fixture asserts the two agree, as the
 * Go side does for its own copy of this constant.
 */
export const API_PREFIX = "/api/v1";

export const baseline = new Baseline(join(packageRoot, "known-failures.json"));

/** One booted instance of this working tree's server, and the spec it serves. */
export interface Instance {
  zitadel: ConnectedZitadel;
  /** The resource API's base URL, including the path prefix. */
  baseUrl: string;
  spec: OpenApiSpec;
  specText: string;
  /** Makes a project of its own on the instance, with the credentials it answers to. */
  project: () => Promise<Credentials>;
  /** Where an operation (`METHOD /path`) is defined in the spec's source. */
  locate: (operation: string) => SourceLocation | undefined;
}

/** How many shards the operations are dealt into: `API_CONTRACT_SHARDS`, else four. */
const SHARDS = Math.max(1, Math.floor(Number(process.env.API_CONTRACT_SHARDS)) || 4);

/**
 * Puts the verdict where a person looks first: the run's summary page, error
 * annotations on the check (each pointing at the operation's definition in the
 * spec's source), a file beside the raw reports, and the log, in plain text,
 * folded away when nothing broke.
 */
async function publish(summary: ContractSummary, instance: Instance): Promise<void> {
  const page = summary.markdown();
  const directory = join(packageRoot, "test-output");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "summary.md"), page);
  if (process.env.GITHUB_ACTIONS) {
    const verdict = summary.problems().length === 0;
    console.info(verdict ? "::group::API contract: passed" : "::group::API contract: broken");
    console.info(summary.text());
    console.info("::endgroup::");
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${page}\n`);
    }
    for (const line of summary.annotations(instance.locate)) {
      console.info(line);
    }
  } else {
    console.info(`\n${summary.text()}\n`);
  }
}

/**
 * The suite's fixtures, each built before the first test of the file that asks
 * for it and torn down after the last:
 *
 * - `workDir`: a scratch folder the Schemathesis container mounts.
 * - `instance`: a real server of this working tree, booted once, and the spec
 *   it serves. Testing the spec the binary serves, and not the YAML beside it,
 *   is the point: it is the contract a customer's client reads, and it cannot
 *   drift from the server under test.
 * - `schemathesis`: the one Schemathesis container, started idle with that
 *   spec; each command is run inside it.
 * - `contract`: what Schemathesis found, published as the run's summary.
 */
export const test = base.extend<{
  workDir: string;
  instance: Instance;
  schemathesis: Schemathesis;
  contract: CommandRun[];
}>({
  workDir: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest reads the fixtures a function needs from its destructured first argument, so it must be a pattern even when empty.
    async ({}, use) => {
      const directory = await mkdtemp(join(tmpdir(), "api-contract-"));
      // Schemathesis's container user must be able to reach the folders below it.
      await chmod(directory, 0o755);
      await use(directory);
      await rm(directory, { recursive: true, force: true });
    },
    { scope: "file" },
  ],

  instance: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest reads the fixtures a function needs from its destructured first argument, so it must be a pattern even when empty.
    async ({}, use) => {
      const zitadel = await startLocalZitadel({
        serverBinary:
          process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
      });
      try {
        const root = zitadel.handle.baseUrl.replace(/\/$/, "");
        const baseUrl = `${root}${API_PREFIX}`;
        const response = await fetch(`${baseUrl}/openapi.json`);
        if (!response.ok) {
          throw new Error(`GET ${baseUrl}/openapi.json answered ${String(response.status)}`);
        }
        const specText = await response.text();
        const spec = OpenApiSpec.parse(specText);
        if (spec.prefix !== API_PREFIX) {
          throw new Error(
            `the served spec's servers URL is ${String(spec.prefix)}, not ${API_PREFIX}`,
          );
        }
        const project = async (): Promise<Credentials> => {
          const bootstrapped = await bootstrapProject({ baseUrl: root });
          const connected = connectZitadel({
            baseUrl: root,
            projectId: bootstrapped.projectId,
            projectSecret: bootstrapped.projectSecret,
            schemaId: bootstrapped.schemaId,
            previewSecret: bootstrapped.previewSecret,
          });
          return new Credentials(connected, spec, baseUrl);
        };
        const sources = new OperationSources(
          join(workspaceRoot, "apps", "api", "api", "openapi"),
          workspaceRoot,
        );
        const ids = new Map(
          spec.operations().map((operation) => {
            return [operation.name, operation.id];
          }),
        );
        const locate = (operation: string): SourceLocation | undefined => {
          const id = ids.get(operation);
          return id === undefined ? undefined : sources.find(id);
        };
        await use({ zitadel, baseUrl, spec, specText, project, locate });
      } finally {
        await zitadel.stop();
      }
    },
    { scope: "file" },
  ],

  schemathesis: [
    async ({ workDir, instance }, use) => {
      const container = await Schemathesis.start(workDir, instance.specText);
      try {
        await use(container);
      } finally {
        await container.stop();
      }
    },
    { scope: "file" },
  ],

  contract: [
    async ({ instance, schemathesis }, use) => {
      const runs = await new Contract({
        spec: instance.spec,
        baseUrl: instance.baseUrl,
        project: instance.project,
        shards: SHARDS,
        runner: schemathesis,
        artifactsDir: join(packageRoot, "test-output", "schemathesis"),
        log: (message) => {
          console.info(`[api-contract] ${message}`);
        },
      }).run();
      if (process.env.API_CONTRACT_UPDATE_BASELINE === "1") {
        new BaselineUpdate(runs).apply(baseline);
      }
      await publish(new ContractSummary(runs, baseline), instance);
      await use(runs);
    },
    { scope: "file" },
  ],
});
