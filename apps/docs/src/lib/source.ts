import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import {
  createOpenAPI,
  openapiSource,
  openapiPlugin,
} from "fumadocs-openapi/server";
import path from "node:path";

/** The OpenAPI server instance — reads the monorepo's single spec */
export const openapi = createOpenAPI({
  input: [path.resolve(process.cwd(), "../../api/openapi/openapi-spec.yaml")],
});

/** Guides & tutorials (hand-written MDX) */
export const guideSource = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

/** API reference (auto-generated virtual pages from OpenAPI spec) */
export const apiSource = loader({
  baseUrl: "/api",
  source: await openapiSource(openapi, {
    // Group endpoints by their OpenAPI tag, mirroring the folder structure
    // in api/openapi/endpoints/ (Flows, Sessions, User, etc.)
    groupBy: "tag",
    meta: true,
  }),
  plugins: [openapiPlugin()],
});
