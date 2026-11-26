// zitadel-cli: managed-file v1
import { createMiddleware } from "@solidjs/start/middleware";
import { createZitadelMiddleware } from "@zitadel/sdk-solid-start/server";

export default createMiddleware(
  createZitadelMiddleware({
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  }),
);
