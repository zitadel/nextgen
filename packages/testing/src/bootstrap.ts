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
export async function bootstrapProject(
  options: BootstrapProjectOptions,
): Promise<BootstrappedProject> {
  const { baseUrl } = options;
  const unauthenticated = createZitadelClient({ baseUrl });
  const project = await unauthenticated.createProject({
    name: options.projectName ?? DEFAULT_PROJECT_NAME,
    origins: (options.appOrigins ?? []).map((pattern) => ({
      pattern,
      kind: "preview" as const,
    })),
    seed_defaults: false,
  });
  const client = createZitadelClient({ baseUrl, token: project.project_secret });

  const schemaBody = getDefaultHumanUserSchemaBody({
    preset: options.preset,
    useCase: options.useCase,
  });
  const schema = await client.createSchema(schemaBody, { project_id: project.id });

  const flowBody = getDefaultLoginFlow({
    preset: options.preset,
    useCase: options.useCase,
  });
  const flow = await client.createFlowDefinition({
    project_id: project.id,
    schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    flow_definition: flowBody,
  });

  return {
    projectId: project.id,
    projectSecret: project.project_secret,
    previewSecret: project.preview_secret,
    schemaId: schema.id,
    flowId: flow.id,
  };
}
