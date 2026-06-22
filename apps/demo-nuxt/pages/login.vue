<template>
  <main
    style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f3f4f6;
    "
  >
    <ClientOnly>
      <zitadel-login
        :project="project"
        post-sign-in-url="/admin"
      />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import type { ClientAuthResult } from "@zitadel/sdk-nuxt";
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const auth = useState<ClientAuthResult>("nextgen-auth");
if (auth.value?.isAuthenticated) {
  await navigateTo("/admin");
}

const project = useZitadelProject();
</script>
