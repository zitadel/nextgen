import type { ZitadelConfig } from "@/lib/zitadel/config";
import { ConfigError } from "@/lib/zitadel/errors";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * The most resources a release may pin: the cap `POST /releases/build` enforces.
 */
const MAX_BUNDLE_RESOURCES = 50;

/**
 * The configuration as `POST /releases/build` takes it, grouped by kind.
 *
 * @remarks
 * Loose on purpose: the files are untyped JSON until the deploy's checks have
 * run, and the publisher narrows them to the API's bundle before they are sent.
 */
export type ConfigurationBundle = Readonly<{
  /**
   * Every user schema's wire body.
   */
  schemas: readonly JsonObject[];
  /**
   * Every login flow's wire body.
   */
  flow_definitions: readonly JsonObject[];
  /**
   * Every connection's wire body.
   */
  idps: readonly JsonObject[];
  /**
   * Every policy's wire body; absent when there are none.
   */
  policies?: readonly JsonObject[];
  /**
   * The branding descriptor's wire body; absent when there is none.
   */
  branding?: JsonObject;
}>;

/**
 * A built bundle, and the number of resources it carries across every kind.
 */
export type BuiltBundle = Readonly<{
  /**
   * The bundle to send.
   */
  bundle: ConfigurationBundle;
  /**
   * How many resources it carries across every kind.
   */
  resourceCount: number;
}>;

/**
 * Assemble the bundle a deploy sends: each document's wire body, grouped by
 * kind.
 *
 * @remarks
 * An empty configuration and one over the cap both fail before any server
 * call, with the messages the server would answer.
 *
 * @param config - The configuration.
 * @param store - Where branding's referenced files are read from.
 * @returns The bundle and how many resources it carries.
 * @throws {@link ConfigError} When there is nothing to deploy, more than one
 *   branding, or more resources than a release may pin.
 */
export function toBundle(config: ZitadelConfig, store: ConfigStore): BuiltBundle {
  // A project has one branding, so the bundle carries a single one. The cap
  // below would not catch a second descriptor, so it is refused here, before
  // anything is inlined or sent.
  if (config.brandings.length > 1) {
    throw new ConfigError(
      `A release carries at most one branding, but .zitadel/branding/ holds ${config.brandings.length}`,
      { hint: "A project has a single branding; keep one descriptor under .zitadel/branding/." },
    );
  }
  const branding = config.brandings[0]?.wireBody(store);
  const bundle: ConfigurationBundle = {
    schemas: config.schemas.map((schema) => {
      return schema.wireBody(store);
    }),
    flow_definitions: config.flows.map((flow) => {
      return flow.wireBody(store);
    }),
    idps: config.connections.map((connection) => {
      return connection.wireBody(store);
    }),
    ...(config.policies.length === 0
      ? {}
      : {
          policies: config.policies.map((policy) => {
            return policy.wireBody(store);
          }),
        }),
    ...(branding === undefined ? {} : { branding }),
  };
  const resourceCount =
    config.schemas.length +
    config.flows.length +
    config.connections.length +
    config.policies.length +
    config.brandings.length;
  if (resourceCount === 0) {
    throw new ConfigError("There is nothing in .zitadel/ to deploy", {
      hint: "Add a schema, flow, policy or branding under .zitadel/, or run `zitadel setup` to scaffold one.",
    });
  }
  if (resourceCount > MAX_BUNDLE_RESOURCES) {
    throw new ConfigError(
      `A release pins at most ${MAX_BUNDLE_RESOURCES} resources, but .zitadel/ holds ${resourceCount}`,
    );
  }
  return { bundle, resourceCount };
}
