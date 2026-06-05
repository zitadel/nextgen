<template>
  <div>
    <p style="color: #6b7280; margin-bottom: 24px">
      Signed in as {{ session?.user_id ?? session?.session_id ?? "loading…" }}
    </p>

    <template v-if="error">
      <p style="color: #ef4444; font-size: 14px">Session details: {{ error }}</p>
    </template>

    <template v-else-if="session">
      <h2 style="font-size: 16px; font-weight: 600; margin-bottom: 12px">Session details</h2>
      <table style="width: 100%; font-size: 14px; border-collapse: collapse">
        <tbody>
          <tr v-for="[label, value] in rows" :key="label" style="border-bottom: 1px solid #e5e7eb">
            <td style="padding: 6px 8px; color: #6b7280; font-weight: 500">{{ label }}</td>
            <td style="padding: 6px 8px; font-family: monospace; word-break: break-all">
              {{ value }}
            </td>
          </tr>
        </tbody>
      </table>

      <template v-if="session.factors?.length">
        <h3 style="font-size: 14px; font-weight: 600; margin-top: 16px; margin-bottom: 8px">
          Verified factors
        </h3>
        <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px">
          <li v-for="(f, i) in session.factors" :key="i" style="padding: 4px 0; color: #374151">
            <strong>{{ f.method }}</strong>
            <span style="color: #9ca3af"> — {{ new Date(f.verified_at).toLocaleString() }}</span>
          </li>
        </ul>
      </template>
    </template>

    <template v-else>
      <p style="color: #9ca3af; font-size: 14px">Loading session details…</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { GetMySession200 } from "@zitadel/api/generated/model";

const session = ref<GetMySession200 | null>(null);
const error = ref<string | null>(null);

const rows = computed<[string, string][]>(() => {
  if (!session.value) return [];
  return [
    ["Session ID", session.value.session_id],
    ["Project ID", session.value.project_id],
    ["State", session.value.state],
    ["User ID", session.value.user_id ?? "—"],
    ["Created", new Date(session.value.created_at).toLocaleString()],
    ["Expires", new Date(session.value.expires_at).toLocaleString()],
  ];
});

onMounted(async () => {
  try {
    // Dynamic import to avoid SSR issues — these modules are client-only.
    const { configureZitadel, getApi } = await import("@zitadel/api/config");
    const config = useRuntimeConfig();
    const project = configureZitadel({
      proxyPath: config.public.nextgenProxyPath as string,
      projectId: config.public.zitadelProjectId as string,
    });
    const api = getApi(project);
    session.value = await api.getMySession();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to fetch session";
  }
});
</script>
