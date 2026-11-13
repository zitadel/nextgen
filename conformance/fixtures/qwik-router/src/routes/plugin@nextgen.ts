// zitadel-cli: managed-file v1
import { createNextgenOnRequest } from "@zitadel/sdk-qwik-router/server";

export const onRequest = createNextgenOnRequest({
  protectedRoutes: ["/profile"],
  loginPath: "/login",
});
