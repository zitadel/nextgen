import { createNextgenProxyHandler } from "@nextgen/sdk-nuxt/server";

const { nextgenBackendUrl, nextgenSecretKey } = useRuntimeConfig();

export default createNextgenProxyHandler({
  backendUrl: nextgenBackendUrl as string,
  secretKey: nextgenSecretKey as string,
  proxyPath: "/__nextgen",
});
