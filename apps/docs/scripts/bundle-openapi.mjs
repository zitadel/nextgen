// Thin wrapper: the shared bundler lives at scripts/bundle-openapi.mjs.
import { bundleOpenAPI } from "../../../scripts/bundle-openapi.mjs";

await bundleOpenAPI({ docs: true });
