import { useState } from "#imports";

import type { ClientAuthResult } from "../types";

/**
 * Returns the current auth state in a Nuxt page or component.
 *
 * The state is seeded server-side by the Nextgen plugin and hydrated on the
 * client automatically. No additional setup is required beyond registering
 * the middleware.
 *
 * The returned {@link ClientAuthResult} intentionally omits the raw JWT —
 * use {@link getAuth} in a server route or middleware when the token is
 * needed to call upstream APIs.
 *
 * ```vue
 * <script setup lang="ts">
 * const auth = useAuth();
 * </script>
 *
 * <template>
 *   <p>{{ auth.isAuthenticated ? (auth.session.display ?? auth.session.identifier) : 'Not signed in' }}</p>
 * </template>
 * ```
 *
 * @returns The current {@link ClientAuthResult}.
 */
export const useAuth = (): ClientAuthResult =>
  useState<ClientAuthResult>("nextgen-auth", () => ({
    isAuthenticated: false,
    session: null,
  })).value;
