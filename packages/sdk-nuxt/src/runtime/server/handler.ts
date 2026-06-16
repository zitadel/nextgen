import { useRuntimeConfig } from '#imports';

import { createNextgenMiddleware } from './middleware';

const config = useRuntimeConfig() as {
  nextgen?: {
    url?: string;
    issuerUrl?: string;
    loginPath?: string;
    protectedRoutes?: string[];
  };
};

/**
 * Default Nitro/H3 event handler registered by the `@zitadel/sdk-nuxt` module
 * via {@link addServerHandler}. Reads middleware options from Nuxt runtime
 * config (`nuxt.config.ts → nextgen`) so consumers do not need to create
 * their own `server/middleware/auth.ts` when using the module.
 */
export default createNextgenMiddleware({
  url:
    config.nextgen?.url ?? config.nextgen?.issuerUrl ?? 'http://localhost:4000',
  loginPath: config.nextgen?.loginPath ?? '/login',
  protectedRoutes: config.nextgen?.protectedRoutes ?? [],
});
