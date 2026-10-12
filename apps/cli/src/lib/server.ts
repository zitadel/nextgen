import { ZitadelError } from "./errors";
import { resolveLocalServer } from "./local-server/runtime";

/**
 * Server URL `setup` connects to when `--server` is not given. Also surfaced
 * in hints and the interactive setup prompt as the suggested value, so it is
 * exported rather than kept private.
 */
export const DEFAULT_SERVER = "https://api.zitadel.cloud";

/**
 * The resolved target server plus the source it came from. `origin` is
 * retained (not just the value) so callers can report *why* a server was
 * chosen.
 */
export type ResolvedServer = {
  value: string;
  origin: "flag" | "default" | "local";
};

/**
 * Inputs to {@link resolveServer}. Passed explicitly (cwd) rather than read
 * from globals so resolution is pure and testable. `serverFlag` comes from the
 * parsed CLI invocation.
 */
export type ResolveServerInput = {
  cwd: string;
  serverFlag?: string;
};

/**
 * Resolves which server `setup` should create its project on: the `--server`
 * flag, else {@link DEFAULT_SERVER}. Every other command takes its server from
 * `ZITADEL_URL` (see `resolveEnvironment`), because a project belongs to the
 * server that created it and the default says nothing about that. A flag
 * value is validated to a normalised origin; an invalid URL throws a
 * `ZitadelError` rather than silently falling through.
 */
export async function resolveServer(input: ResolveServerInput): Promise<ResolvedServer> {
  if (!input.serverFlag) {
    return { value: DEFAULT_SERVER, origin: "default" };
  }
  if (input.serverFlag === "local") {
    return { value: await resolveLocalServer(input.cwd), origin: "local" };
  }
  return { value: serverOrigin(input.serverFlag), origin: "flag" };
}

/** Normalises a server URL to its origin, or throws `E_VALIDATION` when it is not an http(s) URL. */
export function serverOrigin(value: string): string {
  if (!URL.canParse(value)) {
    throw new ZitadelError("E_VALIDATION", `Invalid server "${value}"`, {
      hint: `Use a URL like ${DEFAULT_SERVER}.`,
    });
  }
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ZitadelError("E_VALIDATION", `Server URL must use http(s): ${value}`, {
      hint: `Use a URL like ${DEFAULT_SERVER}.`,
    });
  }
  return url.origin;
}
