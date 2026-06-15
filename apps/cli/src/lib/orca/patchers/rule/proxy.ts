/**
 * The same-origin path the SDK widgets call (`configureZitadel({ proxyPath })`),
 * which every framework's dev proxy forwards to the backend. Framework-agnostic:
 * Vite (React/Vue), Angular's dev-server proxy, and Nuxt's server middleware all
 * key off the same prefix, so it lives here rather than in any one framework's
 * patcher.
 */
export const PROXY_PATH = "/__nextgen";
