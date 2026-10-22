<script setup lang="ts">
const config = useRuntimeConfig();
const appConfig = useAppConfig();
const { $hello, $helloTemplate } = useNuxtApp();
const greeting = useGreeting("home");
const timing = useTimingLabel();
</script>

<template>
  <main>
    <HelloBanner name="banner" />
    <HelloExtra />
    <p data-test="composable">{{ greeting }}</p>
    <p data-test="auto-import">{{ timing }}</p>
    <p data-test="plugin">{{ $hello }}</p>
    <p data-test="plugin-template">{{ $helloTemplate }}</p>
    <p data-test="app-config">{{ appConfig.helloTiming.title }}</p>
    <p data-test="greetings">{{ config.public.helloTiming.greetings.join("|") }}</p>
    <p data-test="nuxt">{{ config.public.helloTiming.nuxtVersion }}|{{ config.public.helloTiming.nuxtMajor4 }}|{{ config.public.helloTiming.extraComponents }}</p>
    <p class="hello-global" data-test="css">styled</p>
  </main>
</template>
