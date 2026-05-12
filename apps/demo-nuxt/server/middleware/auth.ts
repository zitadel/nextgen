import { createNextgenMiddleware } from "@nextgen/sdk-nuxt/server";

const { nextgenIssuerUrl } = useRuntimeConfig();

export default createNextgenMiddleware({
  issuerUrl: nextgenIssuerUrl as string,
  protectedRoutes: ["/admin", "/admin/*"],
  loginPath: "/login",
});
