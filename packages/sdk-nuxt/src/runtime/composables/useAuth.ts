import { useState } from '#imports';

import type { AuthResult } from '../types';

/**
 * Returns the current auth state in a Nuxt page or component.
 *
 * The state is seeded server-side by the Nextgen plugin and hydrated on the
 * client automatically. No additional setup is required beyond registering
 * the middleware.
 *
 * ```vue
 * <script setup lang="ts">
 * const auth = useAuth();
 * </script>
 *
 * <template>
 *   <p>{{ auth.isAuthenticated ? auth.session.email : 'Not signed in' }}</p>
 * </template>
 * ```
 *
 * @returns The current {@link AuthResult}.
 */
export const useAuth = (): AuthResult =>
  useState<AuthResult>('nextgen-auth').value;
