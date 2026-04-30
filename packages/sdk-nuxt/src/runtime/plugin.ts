import { defineNuxtPlugin, useRequestEvent, useState } from '#imports';

import type { AuthResult } from './types';

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };
  useState<AuthResult>('nextgen-auth', () => auth);
});
