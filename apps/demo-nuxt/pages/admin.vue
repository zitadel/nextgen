<template>
  <main style="padding: 48px; max-width: 600px; margin: 0 auto">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px">
      <h1 style="font-size: 24px; font-weight: 700; margin: 0">Admin</h1>
      <ClientOnly>
        <zitadel-logout api-base="/__nextgen" post-sign-out-url="/login" />
      </ClientOnly>
    </div>
    <p style="color: #6b7280">
      Signed in as {{ auth?.isAuthenticated ? auth.session.email : "unknown" }}
    </p>
    <ClientOnly>
      <template v-if="sessionState">
        <h2 style="font-size: 16px; font-weight: 600; margin-top: 24px">Session state</h2>
        <pre
          style="
            background: #f3f4f6;
            padding: 16px;
            border-radius: 8px;
            font-size: 12px;
            overflow-x: auto;
          "
        >{{ JSON.stringify(sessionState, null, 2) }}</pre>
      </template>
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import type { ClientAuthResult } from "@zitadel-nextgen/sdk-nuxt";
import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import { getMySession } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";

const auth = useState<ClientAuthResult>("nextgen-auth");
const sessionState = ref<Record<string, unknown> | null>(null);

onMounted(async () => {
  setApiBaseUrl("/__nextgen");
  try {
    const data = await getMySession({ credentials: "include" });
    sessionState.value = data as unknown as Record<string, unknown>;
  } catch {
    sessionState.value = null;
  }
});
</script>
