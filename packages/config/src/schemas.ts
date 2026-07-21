import {
  CreateFlowDefinitionBody,
  CreateSchemaBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

export const schemaConfigSchema = CreateSchemaBody;
export const flowConfigSchema = CreateFlowDefinitionBody.shape.flow_definition;
export const createFlowDefinitionRequestSchema = CreateFlowDefinitionBody;
