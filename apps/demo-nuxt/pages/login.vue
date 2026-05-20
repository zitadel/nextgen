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
        api-base="/__nextgen"
        project-id="demo"
        post-sign-in-url="/admin"
      />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import type { ClientAuthResult } from "@nextgen/sdk-nuxt";

const auth = useState<ClientAuthResult>("nextgen-auth");
if (auth.value?.isAuthenticated) {
  await navigateTo("/admin");
}
</script>
