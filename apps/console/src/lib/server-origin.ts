import { apiBase } from "@/api/zitadel";

/**
 * The origin of the Zitadel server this console manages: what a CLI command
 * the console suggests names with `--server`, so it reaches this server and
 * not the CLI's default.
 *
 * The console calls the API on its own origin (Console ADR 0002), so that is
 * the server, embedded or hosted. Two cases say otherwise: the dev loop, where
 * the page runs on Vite's origin and vite.config.ts inlines the proxied
 * server's (`CONSOLE_SERVER_ORIGIN`), and an absolute API base.
 */
export function serverOrigin(): string {
  if (import.meta.env.CONSOLE_SERVER_ORIGIN) return import.meta.env.CONSOLE_SERVER_ORIGIN;
  if (URL.canParse(apiBase)) return new URL(apiBase).origin;
  return window.location.origin;
}
