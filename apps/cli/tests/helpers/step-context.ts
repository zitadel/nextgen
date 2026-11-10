import { DeploymentService, SchemaService, UserService, VariableService } from "@/lib/backend";
import type { StepContext } from "@/lib/publish/pipeline";
import { shellCommand } from "@/lib/suggestion";
import { type ConfigStore, type ConfigurationBundle, ZitadelConfig } from "@/lib/zitadel";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";
import { PROJECT_ID } from "@tests/helpers/records";

/**
 * The environment selector every suggestion a step makes carries.
 */
export const ENVIRONMENT_SELECTOR = "--env staging";

/**
 * What a test changes of a step's context: any field of it, and the client
 * operations its services answer.
 */
export type StepContextOverrides = Partial<StepContext> &
  Readonly<{
    /**
     * The operations the deployment, variable, schema and user services
     * answer. Anything left out fails the call that reaches it.
     */
    client?: ClientStubs;
  }>;

/**
 * The context a publish step runs in: a deploy of an empty configuration,
 * under `--json`, addressing the `staging` environment.
 *
 * @remarks
 * The bundle is built from the configuration and the store the context ends
 * up with, unless the overrides give one; without a configuration it is empty,
 * as a release of nothing cannot be built.
 *
 * @param overrides - Fields to set in place of the defaults, and the client stubs.
 * @returns The context.
 */
export function aStepContext(overrides: StepContextOverrides = {}): StepContext {
  const { client: stubs = {}, ...fields } = overrides;
  const client = fakeClient(stubs);
  const config = fields.config ?? ZitadelConfig.empty();
  const store = fields.store ?? new MemoryStore();
  return {
    cwd: "/tmp/project",
    deployments: new DeploymentService(client, PROJECT_ID),
    variables: new VariableService(client, PROJECT_ID),
    schemas: new SchemaService(client, PROJECT_ID),
    users: new UserService(client),
    env: {},
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    config,
    store,
    bundle: fields.bundle ?? bundleOf(fields.config, store),
    suggest: (args) => {
      return shellCommand(`${args} ${ENVIRONMENT_SELECTOR}`);
    },
    ...fields,
  };
}

/**
 * What a release built from the configuration carries.
 *
 * @param config - The configuration, or undefined for none.
 * @param store - Where its `$file` references are read.
 * @returns The bundle, empty when there is no configuration.
 */
function bundleOf(config: ZitadelConfig | undefined, store: ConfigStore): ConfigurationBundle {
  if (config === undefined) {
    return { schemas: [], flow_definitions: [], idps: [], policies: [] };
  }
  return config.bundle(store).bundle;
}
