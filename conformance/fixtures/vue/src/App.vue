<script setup lang="ts">
// zitadel-cli: managed-file v1
import { onMounted } from "vue";
import { ZitadelLogin, ZitadelSession, configureZitadel } from "@zitadel/sdk-vue";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "/__nextgen",
});

const path = window.location.pathname;

onMounted(() => {
  if (path === "/") {
    window.location.replace("/login");
  }
});
</script>

<template>
  <div
    v-if="path.startsWith('/profile')"
    style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark"
  >
    <ZitadelSession :project="project" postSignOutUrl="/login" />
  </div>
  <div
    v-else-if="path.startsWith('/register')"
    style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark"
  >
    <ZitadelLogin :project="project" purpose="register" postSignInUrl="/profile" />
  </div>
  <div v-else-if="path !== '/'" style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin :project="project" purpose="login" postSignInUrl="/profile" />
  </div>
</template>
