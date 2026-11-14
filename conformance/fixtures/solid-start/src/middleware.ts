// zitadel-cli: managed-file v1
import { createMiddleware } from "@solidjs/start/middleware";
import { createNextgenMiddleware } from "@zitadel/sdk-solid-start/server";

export default createMiddleware(
  createNextgenMiddleware({
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  }),
);
