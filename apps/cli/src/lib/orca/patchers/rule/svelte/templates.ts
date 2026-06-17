import { MANAGED_MARKER } from "../../../../paths";

import { PROXY_PATH } from "../proxy";

/**
 * The managed `src/App.svelte`: a minimal path-based router that renders the
 * `@zitadel/sdk-svelte` widgets — login at `/login` (and `/`), register at
 * `/register`, and the logout widget at `/profile`. The managed marker lives in
 * the `<script lang="ts">` block (a JS comment) so eject/doctor stay
 * marker-aware. The project id comes from `VITE_ZITADEL_PROJECT_ID`. No secret
 * reaches the browser: the dev proxy in `vite.config.*` attaches the project
 * service-key secret (from `ZITADEL_PROJECT_SECRET`) server-side.
 */
export function appTemplate(): string {
  return `<script lang="ts">
${MANAGED_MARKER}
import { ZitadelLogin, ZitadelLogout, configureZitadel } from "@zitadel/sdk-svelte";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

const path = window.location.pathname;
</script>

{#if path.startsWith("/profile")}
  <ZitadelLogout {project} postSignOutUrl="/login" />
{:else if path.startsWith("/register")}
  <ZitadelLogin {project} purpose="register" postSignInUrl="/profile" />
{:else}
  <ZitadelLogin {project} purpose="login" postSignInUrl="/profile" />
{/if}
`;
}
