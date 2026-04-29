import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../lib/errors";
import { parseJsonObject } from "../lib/json";

export const DEFAULT_SERVER = "https://api.zitadel.cloud";
export const MOCK_SENTINEL = "mock";

export type ResolvedServer = {
  value: string;
  origin: "flag" | "env" | "config-env" | "config-top" | "default";
};

export type ResolveServerInput = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  serverFlag?: string;
  environment?: string;
  mockFlag?: boolean;
};

export async function resolveServer(input: ResolveServerInput): Promise<ResolvedServer> {
  if (input.mockFlag) {
    return validate({ value: MOCK_SENTINEL, origin: "flag" });
  }
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
    const top = readTopServer(config);
    if (top) {
      return validate({ value: top, origin: "config-top" });
    }
  }

  return { value: DEFAULT_SERVER, origin: "default" };
}

function validate(resolved: ResolvedServer): ResolvedServer {
  if (resolved.value === MOCK_SENTINEL) return resolved;
  try {
    const url = new URL(resolved.value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ZitadelError("E_VALIDATION", `Server URL must use http(s): ${resolved.value}`, {
        hint: `Set "server" in zitadel.json to a URL like ${DEFAULT_SERVER}, or "mock" for offline development.`,
      });
    }
    return { value: url.origin, origin: resolved.origin };
  } catch (error) {
    if (error instanceof ZitadelError) throw error;
    throw new ZitadelError("E_VALIDATION", `Invalid server "${resolved.value}"`, {
      hint: `Use a URL like ${DEFAULT_SERVER}, or the literal "mock".`,
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
  if (!environment) return undefined;
  const envs = config.environments;
  if (!isObject(envs)) return undefined;
  const branch = envs[environment];
  if (!isObject(branch)) return undefined;
  return typeof branch.server === "string" ? branch.server : undefined;
}

function readTopServer(config: Record<string, unknown>): string | undefined {
  return typeof config.server === "string" ? config.server : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
