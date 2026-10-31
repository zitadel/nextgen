import { createZitadelClient } from "@zitadel/api/client";
import {
  DEFAULT_FLOW_SCHEMA_URI,
  getDefaultHumanUserSchema,
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
  previewSecret?: string;
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
  const projectId = project.id;
  const projectSecret = project.project_secret;
  const previewSecret = project.preview_secret;

  const client = createZitadelClient({ baseUrl, token: projectSecret });

  const { $id: _templateId, ...schemaBody } = getDefaultHumanUserSchema({
    preset: options.preset,
    useCase: options.useCase,
  });
  void _templateId;
  const schema = await client.createSchema(schemaBody, { project_id: projectId });
  const schemaId = schema.id;

  const flowBody = getDefaultLoginFlow({
    preset: options.preset,
    useCase: options.useCase,
  });
  const flow = await client.createFlowDefinition({
    project_id: projectId,
    schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    flow_definition: flowBody,
  });

  return { projectId, projectSecret, previewSecret, schemaId, flowId: flow.id };
}
