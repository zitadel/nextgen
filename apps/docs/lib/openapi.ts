import type { OpenAPIV3_2 } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

// The server's API, bundled from api/openapi by scripts/bundle-openapi.mjs and
// imported as a module, so it ships inside the build.
import openapiDocument from "../.generated/openapi.mjs";

// note: this is a server-side API
export const openapi = createOpenAPI({
  input: {
    // fumadocs-openapi types a document as OpenAPI 3.2 and upgrades an older
    // one as it loads it; this one is 3.1.
    "zitadel-nextgen": openapiDocument as unknown as OpenAPIV3_2.Document,
  },
});
