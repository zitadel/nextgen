/**
 * The API's request and response schemas, as the spec generates them. A caller
 * that validates a body before sending it, or reads a field's shape, takes the
 * schema from here and never from the generated package.
 */
export * from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
