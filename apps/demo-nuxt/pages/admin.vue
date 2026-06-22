<template>
  <main style="padding: 48px; max-width: 600px; margin: 0 auto">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px">
      <h1 style="font-size: 24px; font-weight: 700; margin: 0">Admin</h1>
      <ClientOnly>
        <zitadel-logout :project="project" post-sign-out-url="/login" />
      </ClientOnly>
    </div>
    <template v-if="auth?.isAuthenticated">
      <ClientOnly>
        <SessionDetails />
      </ClientOnly>
    </template>
    <p v-else style="color: #6b7280">Not signed in</p>
  </main>
</template>

<script setup lang="ts">
import type { ClientAuthResult } from "@zitadel/sdk-nuxt";
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const auth = useState<ClientAuthResult>("nextgen-auth");
const project = useZitadelProject();
</script>
