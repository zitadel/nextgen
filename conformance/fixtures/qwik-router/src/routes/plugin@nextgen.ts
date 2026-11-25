// zitadel-cli: managed-file v1
import { createNextgenMiddleware } from "@zitadel/sdk-qwik-router/server";

export const onRequest = createNextgenMiddleware({
  protectedRoutes: ["/profile"],
  loginPath: "/login",
});
