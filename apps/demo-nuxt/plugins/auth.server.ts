import { defineNuxtPlugin, useRequestEvent, useState } from "#imports";

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? { isAuthenticated: false as const, session: null };
  useState("nextgen-auth", () => auth);
});
