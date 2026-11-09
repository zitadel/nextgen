import type { ZitadelConfig } from "@/lib/zitadel/config";
import { ConfigError } from "@/lib/zitadel/errors";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/** The most resources a release may pin: the cap `POST /releases/build` enforces. */
const MAX_BUNDLE_RESOURCES = 50;

/**
 * The configuration as `POST /releases/build` takes it, grouped by kind. Loose
 * on purpose: the files are untyped JSON until the deploy's checks have run,
 * and the publisher narrows them to the API's bundle before they are sent.
 */
export type ConfigurationBundle = Readonly<{
  schemas: readonly JsonObject[];
  flow_definitions: readonly JsonObject[];
  idps: readonly JsonObject[];
  policies?: readonly JsonObject[];
  branding?: JsonObject;
}>;

/** A built bundle, and the number of resources it carries across every kind. */
export type BuiltBundle = Readonly<{
  bundle: ConfigurationBundle;
  resourceCount: number;
}>;

/**
 * A body without the editor-only `$schema` pointer, which the server never
 * echoes.
 *
 * @param body - A file's body.
 * @returns The body to send.
 */
function withoutEditorPointer(body: JsonObject): JsonObject {
  const { $schema: _editorOnly, ...rest } = body;
  return rest;
}

/**
 * Assemble the bundle a deploy sends. Schemas, flows and connections are sent
 * as authored, without their `$schema` pointer; the branding descriptor has its
 * `$file` references inlined. An empty configuration and one over the cap both
 * fail before any server call, with the messages the server would answer.
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
      return withoutEditorPointer(schema.body);
    }),
    flow_definitions: config.flows.map((flow) => {
      return withoutEditorPointer(flow.body);
    }),
    idps: config.connections.map((connection) => {
      return withoutEditorPointer(connection.body);
    }),
    ...(config.policies.length === 0
      ? {}
      : {
          policies: config.policies.map((policy) => {
            return policy.wireBody;
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
