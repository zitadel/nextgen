import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  ZITADEL_URL: { description: "The Zitadel server the hook proxies /__nextgen to." },
  ZITADEL_PROJECT_SECRET: { description: "The project's service key, sent on the session exchange only." },
  ZITADEL_PROJECT_ID: { description: "The project whose sessions count as signed in." },
});
