import { createNextgenMiddleware } from './middleware';

/**
 * `useRuntimeConfig` is auto-imported by Nitro when this file is bundled into
 * the consumer's Nuxt application. The declaration here satisfies TypeScript
 * during SDK compilation without introducing a hard runtime dependency.
 */
declare function useRuntimeConfig(): {
  nextgen?: {
    issuerUrl?: string;
    loginPath?: string;
    protectedRoutes?: string[];
  };
};

const config = useRuntimeConfig();

/**
 * Default Nitro/H3 event handler registered by the `@nextgen/sdk-nuxt` module
 * via {@link addServerHandler}. Reads middleware options from Nuxt runtime
 * config (`nuxt.config.ts → nextgen`) so consumers do not need to create
 * their own `server/middleware/auth.ts` when using the module.
 */
export default createNextgenMiddleware({
  issuerUrl: config.nextgen?.issuerUrl ?? 'http://localhost:4000',
  loginPath: config.nextgen?.loginPath ?? '/login',
  protectedRoutes: config.nextgen?.protectedRoutes ?? [],
});
