import { useState } from "#imports";

import type { ZitadelClientAuthResult } from "../types";

/**
 * Returns the current auth state in a Nuxt page or component.
 *
 * The state is seeded on the server by the module's plugin from the session the middleware
 * verified, and it hydrates in the browser automatically. No setup is needed beyond adding the
 * module. It is auto-imported, so an app does not import it.
 *
 * The result is a snapshot of the request that rendered the page: it does not change when the
 * visitor signs in or out in the browser, so navigate or reload after the widget finishes. When
 * the middleware did not run for the request, for example on an ignored route, the state reads
 * as signed out.
 *
 * The returned {@link ZitadelClientAuthResult} omits the raw token on purpose. The token would otherwise
 * be serialized into the server-rendered payload, where scripts on the page could read it. Use
 * `getAuth` in a server route or middleware when the token is needed to call an upstream API.
 *
 * @returns The current {@link ZitadelClientAuthResult}. It is signed out, with a `null` session, when
 *   nobody is signed in.
 *
 * @example
 * ```html
 * <script setup lang="ts">
 * const auth = useAuth();
 * </script>
 *
 * <template>
 *   <p v-if="auth.isAuthenticated">{{ auth.session.display ?? auth.session.identifier }}</p>
 *   <p v-else>Not signed in</p>
 * </template>
 * ```
 */
export const useAuth = (): ZitadelClientAuthResult =>
  useState<ZitadelClientAuthResult>("zitadel-auth", () => ({
    isAuthenticated: false,
    session: null,
  })).value;
