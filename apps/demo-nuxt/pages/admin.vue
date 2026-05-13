<template>
  <main style="padding: 48px; max-width: 600px; margin: 0 auto">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px">
      <h1 style="font-size: 24px; font-weight: 700; margin: 0">Admin</h1>
      <ClientOnly>
        <zitadel-logout proxy-base="/__nextgen" post-sign-out-url="/login" />
      </ClientOnly>
    </div>
    <p style="color: #6b7280">
      Signed in as {{ auth?.isAuthenticated ? auth.session.email : "unknown" }}
    </p>
  </main>
</template>

<script setup lang="ts">
import "@zitadel-nextgen/components";
import type { ClientAuthResult } from "@nextgen/sdk-nuxt";

const auth = useState<ClientAuthResult>("nextgen-auth");
</script>
