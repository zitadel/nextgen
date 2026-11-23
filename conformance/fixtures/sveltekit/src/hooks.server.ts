// zitadel-cli: managed-file v1
import { ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET, ZITADEL_URL } from "$app/env/private";
import { createNextgenHandle } from "@zitadel/sdk-sveltekit/server";

export const handle = createNextgenHandle({
  url: ZITADEL_URL,
  projectSecret: ZITADEL_PROJECT_SECRET,
  projectId: ZITADEL_PROJECT_ID,
  protectedRoutes: ["/profile"],
  loginPath: "/login",
});
