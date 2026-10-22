<script setup lang="ts">
import { computed, useRuntimeConfig } from "#imports";
import { greetingFor } from "../../shared";

const props = defineProps<{ name?: string }>();
const text = computed(() =>
  greetingFor(props.name ?? "banner", useRuntimeConfig().public.helloTiming.greeting),
);
</script>

<template>
  <p class="hello-banner" data-test="banner">{{ (text as string).toString() }}</p>
</template>

<style lang="scss" scoped>
$banner-color: #123456;

.hello-banner {
  color: $banner-color;
}
</style>
