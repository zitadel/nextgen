import { join } from "node:path";

import type { CliIO, GlobalOptions } from "../io/output";
import { ok, writePretty } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { FLOWS_DIR, validateFlows } from "../lib/flows";
import { isObject } from "../lib/json";
import { readJsonDir } from "../lib/json-dir";
import { createPlatformClient } from "../platform";
import { environmentSchema, type ZitadelEnvironment } from "../platform/schemas";
import { buildSyncPlan, makeSyncers, renderPlan, runSyncLoop } from "../lib/sync";
import { readZitadelSecret } from "./shared";

/**
 * Options accepted by {@link runApply}. `planOnly` (and the global `dryRun`)
 * short-circuit to a plan preview without mutating the remote project;
 * `silent` suppresses the success payload so `setup` can call apply as a
 * sub-step without emitting duplicate output. `environment` is validated but
 * not otherwise consumed here, and `platform` is accepted for call-site
 * symmetry with other commands.
 */
export type ApplyOptions = GlobalOptions & {
  silent?: boolean;
  planOnly?: boolean;
  environment?: string;
  platform?: string;
};

/**
 * Applies the local `.zitadel/flows` definitions to the remote project.
 *
 * Preflights the environment name, project secret, and any `${VAR}` /
 * `*_env` references in the flows before contacting the platform so missing
 * configuration fails fast with `E_VALIDATION`. In plan/dry-run mode it
 * renders the diff and returns without writing; otherwise it runs the sync
 * loop to convergence.
 */
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

/**
 * Collects the names of environment variables a flows document depends on,
 * sorted and de-duplicated. Recognises two reference styles: inline
 * `${VAR}` interpolations inside string values, and keys ending in `_env`
 * whose value names a single variable. Used by {@link runApply} to fail
 * before applying when a required variable is absent.
 */
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
