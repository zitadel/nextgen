<template>
  <main
    style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #f3f4f6;
    "
  >
    <ClientOnly>
      <nextgen-login proxy-base="/__nextgen" post-sign-in-url="/admin" />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import "@nextgen/ui-lit";

const auth = useState("nextgen-auth");
if (auth.value?.isAuthenticated) {
  await navigateTo("/admin");
}
</script>
