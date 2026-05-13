import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { createPlatformClient } from "../platform";
import { runSyncLoop } from "../sync/loop";
import { syncers } from "../sync/syncers";
import { readZitadelSecret } from "./shared";

export type ApplyOptions = GlobalOptions & {
  silent?: boolean;
  planOnly?: boolean;
  environment?: string;
  platform?: string;
};

export async function runApply(io: CliIO, opts: ApplyOptions): Promise<void> {
  const secret = await readZitadelSecret(opts.cwd);
  const client = createPlatformClient(opts.source, secret.project_secret);

  if (!opts.planOnly && !opts.dryRun) {
    await runSyncLoop(opts.cwd, client, syncers);
  }

  if (!opts.silent) {
    ok(io, { synced: !opts.planOnly && !opts.dryRun }, opts);
  }
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
