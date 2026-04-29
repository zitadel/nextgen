import { createNextgenAuthMiddleware } from "@nextgen/sdk-nuxt/server";

const { nextgenBackendUrl, nextgenSecretKey } = useRuntimeConfig();

export default createNextgenAuthMiddleware({
  backendUrl: nextgenBackendUrl as string,
  secretKey: nextgenSecretKey as string,
  protectedRoutes: ["/dashboard", "/dashboard/*"],
  signInUrl: "/",
});
