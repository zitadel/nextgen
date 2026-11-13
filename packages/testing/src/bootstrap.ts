import { createZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_FLOW_SCHEMA_URI,
  getDefaultHumanUserSchemaBody,
  getDefaultLoginFlow,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";

export interface BootstrapProjectOptions {
  baseUrl: string;
  projectName?: string;
  /**
   * Origins of the apps that will proxy to this instance. The backend's
   * origin check rejects forwarded requests from unregistered origins.
   */
  appOrigins?: string[];
  preset?: SetupPreset;
  useCase?: SetupUseCase;
}

export interface BootstrappedProject {
  projectId: string;
  projectSecret: string;
  /** The browser-plane credential the server issues with every project. */
  previewSecret: string;
  schemaId: string;
  flowId: string;
}

const DEFAULT_PROJECT_NAME = "zitadel-testing";

/**
 * Server-side half of `zitadel setup`, without any file scaffolding:
 * `POST /projects` is unauthenticated and mints the projectSecret used as the
 * bearer for everything else; the schema is uploaded without `$id` so the
 * server assigns an opaque id, which the flow must then reference.
 */
/**
 * A deployment needs a primary origin. A loopback origin is always admitted, so
 * listing this one opens nothing up.
 */
const FALLBACK_APP_ORIGIN = "http://localhost:3000";

export async function bootstrapProject(
  options: BootstrapProjectOptions,
): Promise<BootstrappedProject> {
  const { baseUrl } = options;
  const unauthenticated = createZitadelClient({ baseUrl });
  const project = await unauthenticated.createProject({
    name: options.projectName ?? DEFAULT_PROJECT_NAME,
    origins: (options.appOrigins?.length ? options.appOrigins : [FALLBACK_APP_ORIGIN]).map(
      (pattern) => ({
        pattern,
        kind: "primary" as const,
      }),
    ),
    seed_defaults: false,
  });
  const client = createZitadelClient({ baseUrl, token: project.project_secret });

  const schemaBody = getDefaultHumanUserSchemaBody({
    preset: options.preset,
    useCase: options.useCase,
  });
  const schema = await client.publishSchema(schemaBody, { project_id: project.id });

  const flowBody = getDefaultLoginFlow({
    preset: options.preset,
    useCase: options.useCase,
  });
  const flow = await client.publishFlowDefinition({
    project_id: project.id,
    schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    flow_definition: flowBody,
  });

  const release = await client.createRelease(
    {
      pointers: [
        { kind: "schema", revision_id: schema.id },
        { kind: "flow_definition", revision_id: flow.id },
      ],
    },
    { project_id: project.id },
  );
  await client.createDeployment(
    { release_id: release.id, targets: "primary" },
    { project_id: project.id },
  );

  return {
    projectId: project.id,
    projectSecret: project.project_secret,
    previewSecret: project.preview_secret,
    schemaId: schema.id,
    flowId: flow.id,
  };
}
