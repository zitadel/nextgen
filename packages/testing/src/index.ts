import { createZitadelClient } from "@zitadel/api/client";

import { applyAppEnvTemplate, nextAppEnv } from "./app-env";
import { bootstrapProject, type BootstrapProjectOptions } from "./bootstrap";
import { bootLocalServer, type BootServerOptions } from "./lifecycle";
import { identity, seedUser, seedUsers } from "./seed";
import { mintSession } from "./session";
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
  const context = { projectId: handle.projectId, schemaId: handle.schemaId };
  const connected: ConnectedZitadel = {
    handle,
    api,
    // The Next-shaped convenience view; other frameworks apply their own
    // template to `handle` (see AppEnvTemplate).
    appEnv: applyAppEnvTemplate(nextAppEnv, handle),
    seedUser: (input) => seedUser(api, context, input),
    seedUsers: (count, template) => seedUsers(api, context, count, template),
    identity,
    seedSession: async (input = {}) => {
      const { user: existing, flowDefinitionName, origin, ...userInput } = input;
      const user = existing ?? (await seedUser(api, context, userInput));
      return mintSession(api, handle, context, user, {
        flowDefinitionName,
        origin: origin ?? handle.appOrigin,
      });
    },
  };
  return connected;
}

/**
 * Boot an ephemeral local instance (binary runtime + SQLite by default, no
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
    appOrigin: options.appOrigins?.[0],
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
export { SESSION_COOKIE_NAME } from "./session";
export type {
  ConnectedZitadel,
  Identity,
  InstanceHandle,
  LocalZitadel,
  LocalZitadelRuntime,
  MintedSession,
  SeededUser,
  SeedSessionInput,
  SeedUserInput,
  SeedUsersTemplate,
  SessionCookie,
} from "./types";
