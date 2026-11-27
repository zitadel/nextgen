import { DeploymentService, SchemaService, UserService, VariableService } from "@/lib/backend";
import type { StepContext } from "@/lib/publish/pipeline";
import { type ConfigStore, type ConfigurationBundle, ZitadelConfig } from "@/lib/zitadel";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import { testClient } from "@tests/helpers/api-answers";
import { PROJECT_ID } from "@tests/helpers/records";

/**
 * What a test changes of a step's context: any field of it.
 */
export type StepContextOverrides = Partial<StepContext>;

/**
 * The context a publish step runs in: a deploy of an empty configuration,
 * under `--json`, addressing the `staging` environment.
 *
 * @remarks
 * The bundle is built from the configuration and the store the context ends
 * up with, unless the overrides give one; without a configuration it is empty,
 * as a release of nothing cannot be built.
 *
 * The deployment, variable, schema and user services run on a real
 * {@link testClient}, so a test answers what they send through its `server`
 * fixture, and a request it did not answer fails it.
 *
 * @param overrides - Fields to set in place of the defaults.
 * @returns The context.
 */
export function aStepContext(fields: StepContextOverrides = {}): StepContext {
  const client = testClient();
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
    referenced:
      fields.referenced ??
      config.branding.all.flatMap((branding) => {
        return branding.listReferencedPaths(store);
      }),
    bundle: fields.bundle ?? bundleOf(fields.config, store),
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
