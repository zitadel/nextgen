import { createZitadelClient, type ZitadelClient } from "@zitadel/api/client";
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
  const project = (await unauthenticated.createProject({
    name: options.projectName ?? DEFAULT_PROJECT_NAME,
    previewOrigins: options.appOrigins ?? [],
    seedDefaults: false,
  } as Parameters<ZitadelClient["createProject"]>[0])) as Record<string, unknown>;
  const projectId = requireString(project.id, "project id");
  const projectSecret = requireString(project.projectSecret, "project secret");
  const previewSecret =
    typeof project.previewSecret === "string" ? project.previewSecret : undefined;

  const client = createZitadelClient({ baseUrl, token: projectSecret });

  const { $id: _templateId, ...schemaBody } = getDefaultHumanUserSchema({
    preset: options.preset,
    useCase: options.useCase,
  }) as { $id?: string } & Record<string, unknown>;
  void _templateId;
  const schema = (await client.createSchema(
    schemaBody as Parameters<ZitadelClient["createSchema"]>[0],
    { project_id: projectId },
  )) as Record<string, unknown>;
  const schemaId = requireString(schema.id, "schema id");

  const flowBody = getDefaultLoginFlow({
    userSchemaUrl: schemaId,
    preset: options.preset,
    useCase: options.useCase,
  });
  const flow = (await client.createFlowDefinition({
    project_id: projectId,
    schema_uri: DEFAULT_FLOW_SCHEMA_URI,
    flow_definition: flowBody,
  } as Parameters<ZitadelClient["createFlowDefinition"]>[0])) as Record<string, unknown>;
  const flowId = requireString(flow.id, "flow definition id");

  return { projectId, projectSecret, previewSecret, schemaId, flowId };
}

export function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing ${label} in server response.`);
}
