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
      <!-- This page fixes its surface to light (the <main> background), so
           declare it on the widget: the element-level `theme` outranks tenant
           branding (the dev mock pins dark), which is the documented contract
           for embedding into a page whose colour is not negotiable. -->
      <zitadel-login
        :project="project"
        theme="light"
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
