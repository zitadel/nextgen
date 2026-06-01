import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../errors";
import { isObject, parseJsonObject } from "../json";

/**
 * Server URL used when nothing else resolves. Also surfaced in hints and
 * the interactive setup prompt as the suggested value, so it is exported
 * rather than kept private.
 */
export const DEFAULT_SERVER = "https://api.zitadel.cloud";

/**
 * The resolved target server plus the source it came from. `origin` is
 * retained (not just the value) so callers can report *why* a server was
 * chosen and so the precedence order stays auditable.
 */
export type ResolvedServer = {
  value: string;
  origin: "flag" | "env" | "config-env" | "config-top" | "default";
};

/**
 * Inputs to {@link resolveServer}. Passed explicitly (cwd, env) rather
 * than read from globals so resolution is pure and testable. `serverFlag`
 * and `environment` come from the parsed CLI invocation.
 */
export type ResolveServerInput = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  serverFlag?: string;
  environment?: string;
};

/**
 * Resolves which server the CLI should target, applying a fixed
 * precedence: explicit `--server` flag, then `ZITADEL_API_BASE`, then the
 * selected environment block in `zitadel.json`, then the config's
 * top-level `server`, falling back to {@link DEFAULT_SERVER}. Every
 * candidate is validated to a normalised origin; an invalid URL throws a
 * `ZitadelError` rather than silently falling through.
 */
export async function resolveServer(input: ResolveServerInput): Promise<ResolvedServer> {
  if (input.serverFlag) {
    return validate({ value: input.serverFlag, origin: "flag" });
  }
  const envValue = input.env.ZITADEL_API_BASE;
  if (envValue) {
    return validate({ value: envValue, origin: "env" });
  }

  const config = await readConfig(input.cwd);
  if (config) {
    const envBranch = readEnvServer(config, input.environment);
    if (envBranch) {
      return validate({ value: envBranch, origin: "config-env" });
    }
    if (typeof config.server === "string") {
      return validate({ value: config.server, origin: "config-top" });
    }
  }

  return { value: DEFAULT_SERVER, origin: "default" };
}

function validate(resolved: ResolvedServer): ResolvedServer {
  try {
    const url = new URL(resolved.value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ZitadelError("E_VALIDATION", `Server URL must use http(s): ${resolved.value}`, {
        hint: `Set "server" in zitadel.json to a URL like ${DEFAULT_SERVER}.`,
      });
    }
    return { value: url.origin, origin: resolved.origin };
  } catch (error) {
    if (error instanceof ZitadelError) {
      throw error;
    }
    throw new ZitadelError("E_VALIDATION", `Invalid server "${resolved.value}"`, {
      hint: `Use a URL like ${DEFAULT_SERVER}.`,
      details: { origin: resolved.origin },
    });
  }
}

async function readConfig(cwd: string): Promise<Record<string, unknown> | undefined> {
  try {
    const contents = await readFile(join(cwd, "zitadel.json"), "utf8");
    return parseJsonObject(contents, "zitadel.json");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

function readEnvServer(
  config: Record<string, unknown>,
  environment: string | undefined,
): string | undefined {
  if (!environment) {
    return undefined;
  }
  const envs = config.environments;
  if (!isObject(envs)) {
    return undefined;
  }
  const branch = envs[environment];
  if (!isObject(branch)) {
    return undefined;
  }
  return typeof branch.server === "string" ? branch.server : undefined;
}
