import { join } from "node:path";

import type { CliIO, GlobalOptions } from "../io/output";
import { ok, writePretty } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { FLOWS_DIR, validateFlows } from "../lib/flows";
import { readJsonDir } from "../lib/json-dir";
import { createPlatformClient } from "../platform";
import { environmentSchema, type ZitadelEnvironment } from "../platform/schemas";
import { buildSyncPlan, runSyncLoop } from "../sync/loop";
import { renderPlan } from "../sync/plan-renderer";
import { makeSyncers } from "../sync/syncers";
import { readZitadelSecret } from "./shared";

export type ApplyOptions = GlobalOptions & {
  silent?: boolean;
  planOnly?: boolean;
  environment?: string;
  platform?: string;
};

export async function runApply(io: CliIO, opts: ApplyOptions): Promise<void> {
  parseEnvironment(opts.environment);
  const secret = await readZitadelSecret(opts.cwd);

  const flows = await readJsonDir(join(opts.cwd, FLOWS_DIR));
  validateFlows(flows);

  const envRefs = findEnvRefs(flows);
  const missing = envRefs.filter((name) => !io.env[name]);
  if (missing.length > 0) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Missing environment variables: ${missing.join(", ")}`,
    );
  }

  const client = createPlatformClient(opts.source, secret.project_secret);
  const syncers = makeSyncers({ projectId: secret.project_id });

  if (opts.planOnly || opts.dryRun) {
    const plan = await buildSyncPlan(opts.cwd, syncers, client);
    if (opts.json) {
      const active = plan.filter((a) => a.kind !== "skip");
      ok(io, {
        creates: active.filter((a) => a.kind === "create").length,
        updates: active.filter((a) => a.kind === "update").length,
        deletes: active.filter((a) => a.kind === "delete").length,
        total: active.length,
      }, opts);
    } else {
      writePretty(io, renderPlan(plan, io.isTTY));
    }
    return;
  }

  await runSyncLoop(opts.cwd, client, syncers);

  if (!opts.silent) {
    ok(io, { synced: true }, opts);
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
