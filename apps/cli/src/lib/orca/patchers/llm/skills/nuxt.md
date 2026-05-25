# Nuxt — Zitadel Integration Skill

## Step 1 — Install the SDK (best-effort)

Attempt to install the package. If the registry does not have it yet, continue anyway —
the next steps do not depend on the install succeeding.

```
pnpm add @zitadel-nextgen/sdk-nuxt@latest
```

## Step 2 — Edit `nuxt.config.ts`

Rewrite the file to add the module and `nextgen` config. Use `defineNuxtConfig` and keep
any existing options that were already present.

```ts
// zitadel-cli: managed-file v1
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  modules: ['@zitadel-nextgen/sdk-nuxt'],
  nextgen: {
    issuerUrl: process.env.NEXTGEN_ISSUER_URL,
    protectedRoutes: ['/profile*'],
    loginPath: '/login',
  },
})
```

## Step 3 — Create `composables/useAuth.ts`

Only needed if `@zitadel-nextgen/sdk-nuxt` was not installed. This provides the `useAuth()`
composable so the profile page compiles without the module.

```ts
// zitadel-cli: managed-file v1
import { ref, readonly } from 'vue'

export function useAuth() {
  const isAuthenticated = ref(false)
  const user = ref<Record<string, unknown> | null>(null)
  const pending = ref(true)
  return { isAuthenticated: readonly(isAuthenticated), user: readonly(user), pending: readonly(pending) }
}
```

## Step 4 — Create `pages/login.vue`

Render the `<zitadel-login>` web component wrapped in `<ClientOnly>`.

```vue
<!-- zitadel-cli: managed-file v1 -->
<template>
  <ClientOnly>
    <zitadel-login />
  </ClientOnly>
</template>
```

## Step 5 — Create `pages/register.vue`

Same as `login.vue` but with `purpose="register"`.

```vue
<!-- zitadel-cli: managed-file v1 -->
<template>
  <ClientOnly>
    <zitadel-login purpose="register" />
  </ClientOnly>
</template>
```

## Step 6 — Create `pages/profile.vue`

Call `useAuth()`. Redirect to `/login` when not authenticated; show email and name when signed in.

```vue
<!-- zitadel-cli: managed-file v1 -->
<template>
  <div v-if="pending">Loading…</div>
  <div v-else-if="!isAuthenticated">
    <NuxtLink to="/login">Sign in</NuxtLink>
  </div>
  <div v-else>
    <p>{{ user?.email }}</p>
    <ClientOnly><zitadel-logout /></ClientOnly>
  </div>
</template>

<script setup lang="ts">
const { isAuthenticated, user, pending } = useAuth()
watchEffect(() => { if (!pending.value && !isAuthenticated.value) navigateTo('/login') })
</script>
```

## Step 7 — Create `zitadel-custom-elements.d.ts`

```ts
// zitadel-cli: managed-file v1
import type { DefineComponent } from 'vue'
declare module 'vue' {
  interface GlobalComponents {
    ZitadelLogin: DefineComponent<{ purpose?: string }>
    ZitadelLogout: DefineComponent
  }
}
export {}
```

## Notes

- **Do all steps**, even if the SDK install (Step 1) fails. The pages and composable are
  required regardless.
- Every file you create or modify must begin with `<!-- zitadel-cli: managed-file v1 -->` for
  `.vue` files, or `// zitadel-cli: managed-file v1` for `.ts` files, as the very first line.
- `NEXTGEN_ISSUER_URL` and `ZITADEL_PROJECT_ID` are already written to `.env.local` — do not
  create or overwrite that file.
- `useAuth()` is auto-imported by the Nuxt module when installed, and provided by the
  composable you write in Step 3 when it is not. Either way, no explicit import is needed
  in the `.vue` files.
- Do not add a top-level provider wrapper; the web components are self-contained.
