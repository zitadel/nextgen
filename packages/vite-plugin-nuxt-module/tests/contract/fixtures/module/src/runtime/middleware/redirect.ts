import { defineNuxtRouteMiddleware, navigateTo, useRuntimeConfig } from "#imports";

export default defineNuxtRouteMiddleware((to) => {
  if (to.path === useRuntimeConfig().public.helloTiming.secretPath) return navigateTo("/hello");
});
