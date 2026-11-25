// zitadel-cli: managed-file v1
import { ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET, ZITADEL_URL } from "$app/env/private";
import { createNextgenMiddleware } from "@zitadel/sdk-sveltekit/server";

export const handle = createNextgenMiddleware({
  url: ZITADEL_URL,
  projectSecret: ZITADEL_PROJECT_SECRET,
  projectId: ZITADEL_PROJECT_ID,
  protectedRoutes: ["/profile"],
  loginPath: "/login",
});
