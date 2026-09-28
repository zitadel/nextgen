import type { InstanceHandle } from "./types";

/**
 * Handle fields a template may reference: the flat string facts. Structured
 * fields (e.g. `platform`) are not env-var material — consumers read those
 * from the handle directly.
 */
type StringHandleField = {
  [K in keyof InstanceHandle]-?: InstanceHandle[K] extends string | undefined ? K : never;
}[keyof InstanceHandle];

/**
 * Declarative mapping from an app's env var names to InstanceHandle fields.
 * A template (not a function) so it can cross process boundaries: the
 * Playwright config serializes it into the app-runner's environment, where it
 * is applied to the handle read from the handshake file.
 */
export type AppEnvTemplate = Record<string, StringHandleField>;

/**
 * The env shape `@zitadel/sdk-next` apps read. Other frameworks pass their own
 * template — the console maps the same handle fields to `VITE_*`/`CONSOLE_*`
 * names, for example.
 */
export const nextAppEnv: AppEnvTemplate = {
  ZITADEL_URL: "baseUrl",
  NEXT_PUBLIC_ZITADEL_PROJECT_ID: "projectId",
  ZITADEL_PROJECT_SECRET: "projectSecret",
};

export function applyAppEnvTemplate(
  template: AppEnvTemplate,
  handle: InstanceHandle,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, field] of Object.entries(template)) {
    const value = handle[field];
    if (typeof value !== "string" || value.length === 0) {
      // Fail instead of silently dropping the var: an app booted without one
      // of its env vars produces a much harder-to-read failure downstream.
      throw new Error(
        `app env template maps "${name}" to handle field "${field}", which the instance handle does not carry`,
      );
    }
    env[name] = value;
  }
  return env;
}
