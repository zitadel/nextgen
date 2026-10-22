<script setup lang="ts">
import { definePageMeta } from "#imports";
import { useGreeting } from "../composables/useGreeting";

definePageMeta({ layout: "hello" });
const greeting = useGreeting("hello page");
</script>

<template>
  <section data-test="hello-page">{{ greeting }}</section>
</template>
