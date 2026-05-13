import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CliIO, GlobalOptions } from "../io/output";
import { ok, writePretty } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { createPlatformClient } from "../platform";
import { environmentSchema, type ZitadelEnvironment } from "../platform/schemas";
import { flowDefinitionSchema } from "../resources/flow";
import { buildSyncPlan, runSyncLoop } from "../sync/loop";
import { renderPlan } from "../sync/plan-renderer";
import { syncers } from "../sync/syncers";
import type { ZitadelSecret } from "./shared";
import { readZitadelSecret } from "./shared";

export type ApplyOptions = GlobalOptions & {
  silent?: boolean;
  planOnly?: boolean;
  environment?: string;
  platform?: string;
};

export async function runApply(io: CliIO, opts: ApplyOptions): Promise<void> {
  const environment = parseEnvironment(opts.environment);
  const secret = await readZitadelSecret(opts.cwd);

  if (environment === "production" && !isClaimedSecret(secret)) {
    throw new ZitadelError(
      "E_CLAIM_REQUIRED",
      "Production applies require a claimed project. Run `zitadel claim`.",
      { nextCommands: ["zitadel claim"] },
    );
  }

  const flows = await readFlowFiles(opts.cwd);

  validateFlowDefinitions(flows);

  const envRefs = findEnvRefs(flows);
  const missing = envRefs.filter((name) => !io.env[name]);
  if (missing.length > 0) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Missing environment variables: ${missing.join(", ")}`,
    );
  }

  const client = createPlatformClient(opts.source, secret.project_secret);

  if (opts.planOnly || opts.dryRun) {
    const plan = await buildSyncPlan(opts.cwd, syncers, client);
    writePretty(io, renderPlan(plan, io.isTTY));
    return;
  }

  await runSyncLoop(opts.cwd, client, syncers);

  if (!opts.silent) {
    ok(io, { synced: true }, opts);
  }
}

async function readFlowFiles(cwd: string): Promise<Record<string, unknown>[]> {
  const dir = join(cwd, ".zitadel/flows");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const results: Record<string, unknown>[] = [];
  for (const entry of entries.filter((e) => e.endsWith(".json"))) {
    try {
      results.push(JSON.parse(await readFile(join(dir, entry), "utf8")) as Record<string, unknown>);
    } catch {
      throw new ZitadelError("E_VALIDATION", `Flow definition ${entry} is not valid JSON`);
    }
  }
  return results;
}

function validateFlowDefinitions(flows: Record<string, unknown>[]): void {
  const issues: Array<{ issues: unknown }> = [];
  for (const flow of flows) {
    const parsed = flowDefinitionSchema.safeParse(flow);
    if (!parsed.success) {
      issues.push({ issues: parsed.error.issues });
    }
  }
  if (issues.length > 0) {
    throw new ZitadelError("E_VALIDATION", "One or more flow definitions are invalid", {
      details: { issues },
    });
  }
}

function parseEnvironment(value: string | undefined): ZitadelEnvironment {
  const result = environmentSchema.safeParse(value ?? "development");
  if (!result.success) {
    throw new ZitadelError("E_VALIDATION", `Invalid environment "${value}"`, {
      hint: "Use one of: development, preview, production.",
    });
  }
  return result.data;
}

function isClaimedSecret(secret: ZitadelSecret): boolean {
  return Boolean(secret.claimed_at && secret.team_id);
}

export function findEnvRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        const ref = match[1];
        if (ref) { refs.add(ref); }
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (
          key.endsWith("_env") &&
          typeof child === "string" &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(child)
        ) {
          refs.add(child);
        } else {
          visit(child);
        }
      }
    }
  };
  visit(value);
  return [...refs].sort();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
