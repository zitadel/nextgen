import { createZitadelClient } from "@zitadel/api/client";

import { applyAppEnvTemplate, nextAppEnv } from "./app-env";
import { bootstrapProject, type BootstrapProjectOptions } from "./bootstrap";
import { bootLocalServer, type BootServerOptions } from "./lifecycle";
import { seedUser } from "./seed";
import type { ConnectedZitadel, InstanceHandle, LocalZitadel } from "./types";

export type StartLocalZitadelOptions = BootServerOptions &
  Omit<BootstrapProjectOptions, "baseUrl">;

/**
 * Attach to an already-bootstrapped instance/project. Lifecycle-free on
 * purpose: this is the entry point for Playwright workers (via the handshake
 * file) and, later, for seeding remote instances.
 */
export function connectZitadel(handle: InstanceHandle): ConnectedZitadel {
  const api = createZitadelClient({ baseUrl: handle.baseUrl, token: handle.projectSecret });
  return {
    handle,
    api,
    // The Next-shaped convenience view; other frameworks apply their own
    // template to `handle` (see AppEnvTemplate).
    appEnv: applyAppEnvTemplate(nextAppEnv, handle),
    seedUser: (input) =>
      seedUser(api, { projectId: handle.projectId, schemaId: handle.schemaId }, input),
  };
}

/**
 * Boot an ephemeral local instance (binary runtime + embedded Postgres, no
 * Docker) and bootstrap a project + default schema + login flow on it. The
 * result can seed loginable password users immediately.
 */
export async function startLocalZitadel(
  options: StartLocalZitadelOptions = {},
): Promise<LocalZitadel> {
  const server = await bootLocalServer(options);
  let bootstrapped;
  try {
    bootstrapped = await bootstrapProject({
      baseUrl: server.baseUrl,
      projectName: options.projectName,
      appOrigins: options.appOrigins,
      preset: options.preset,
      useCase: options.useCase,
    });
  } catch (error) {
    try {
      await server.stop();
    } catch (stopError) {
      // Both errors are preserved in AggregateError.errors, which the rule
      // below cannot model.
      // oxlint-disable-next-line preserve-caught-error
      throw new AggregateError(
        [error, stopError],
        "bootstrap failed, and stopping the booted instance also failed",
      );
    }
    throw error;
  }
  const handle: InstanceHandle = {
    baseUrl: server.baseUrl,
    projectId: bootstrapped.projectId,
    projectSecret: bootstrapped.projectSecret,
    schemaId: bootstrapped.schemaId,
    previewSecret: bootstrapped.previewSecret,
  };
  return {
    ...connectZitadel(handle),
    runtime: server.runtime,
    stop: server.stop,
    [Symbol.asyncDispose]: server.stop,
  };
}

export { applyAppEnvTemplate, nextAppEnv } from "./app-env";
export type { AppEnvTemplate } from "./app-env";
export { bootstrapProject } from "./bootstrap";
export type { BootstrapProjectOptions, BootstrappedProject } from "./bootstrap";
export { readHandshakeSync, waitForHandshake, writeHandshake } from "./handshake";
export { bootLocalServer } from "./lifecycle";
export type { BootedServer, BootServerOptions } from "./lifecycle";
export type {
  ConnectedZitadel,
  InstanceHandle,
  LocalZitadel,
  LocalZitadelRuntime,
  SeededUser,
  SeedUserInput,
} from "./types";
