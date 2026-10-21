import { ZitadelError } from "./errors";
import { LocalServer } from "./local-server/server";
import type { Parsed } from "@zitadel/config/idp";
import type { FlagVariable } from "./oclif/types";

/**
 * Server URL `setup` connects to when `--server` is not given. Also surfaced
 * in hints and the interactive setup prompt as the suggested value, so it is
 * exported rather than kept private.
 */
export const DEFAULT_SERVER = "https://preview.zitadel.com";

/** The variable {@link resolveServer} reads when `--server` is not given. */
export const SERVER_VARIABLE: FlagVariable = {
  name: "ZITADEL_API_BASE",
  flag: "server",
  description: "The server URL, or `local`, as `--server` takes it.",
  precedence: "`--server` wins over it, and it wins over `server` in `zitadel.json`.",
};

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
    return { value: await LocalServer.resolveUrl(input.cwd), origin: "local" };
  }
  return { value: serverOrigin(input.serverFlag), origin: "flag" };
}

/**
 * A typed or flagged server as its origin, or the problem with it: the `parse`
 * an input question takes, so a prompt re-asks instead of throwing out of it.
 */
export function parseServer(value: string): Parsed<string> {
  const typed = value.trim();
  if (typed === "") {
    return { ok: false, problem: "Enter the server URL." };
  }
  try {
    return { ok: true, value: serverOrigin(typed) };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
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
