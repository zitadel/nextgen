// zitadel-cli: managed-file v1
import { createZitadelOnRequest } from "@zitadel/sdk-qwik-router/server";

export const onRequest = createZitadelOnRequest({
  protectedRoutes: ["/profile"],
  loginPath: "/login",
});
