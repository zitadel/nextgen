# @nextgen/ui-lit

Framework-agnostic authentication web components for Nextgen Auth, built with [Lit](https://lit.dev).

## Installation

```bash
pnpm add @nextgen/ui-lit
```

## Components

### `<nextgen-login>`

An email/password login form that talks to the Nextgen auth proxy. On success it fires a `nextgen-signin` event and optionally navigates to `post-sign-in-url`.

```html
<nextgen-login
  proxy-base="/__nextgen"
  post-sign-in-url="/dashboard"
></nextgen-login>
```

| Attribute          | Default       | Description                                                  |
| ------------------ | ------------- | ------------------------------------------------------------ |
| `proxy-base`       | `/__nextgen`  | Base path of the auth proxy                                  |
| `post-sign-in-url` | —             | URL to navigate to after a successful sign-in                |

**Events**

| Event            | Detail     | Fires when                                    |
| ---------------- | ---------- | --------------------------------------------- |
| `nextgen-signin` | server data | The backend confirms the session is active   |
| `nextgen-sso`    | —          | The user clicks the SSO button                |

---

### `<nextgen-logout>`

A circular avatar trigger that opens a dropdown showing the signed-in user's name and email with a sign-out button. Reads the `__nextgen_display` cookie (set by the backend on login) to populate the display.

```html
<nextgen-logout
  proxy-base="/__nextgen"
  post-sign-out-url="/login"
></nextgen-logout>
```

| Attribute           | Default      | Description                                    |
| ------------------- | ------------ | ---------------------------------------------- |
| `proxy-base`        | `/__nextgen` | Base path of the auth proxy                    |
| `post-sign-out-url` | —            | URL to navigate to after sign-out              |

**Events**

| Event              | Detail              | Fires when                          |
| ------------------ | ------------------- | ----------------------------------- |
| `nextgen-signout`  | `{ name, email }`   | The session cookie has been cleared |

**Template mode**

Pass a `<template>` child to render your own markup instead of the default avatar dropdown. Tokens `{{name}}`, `{{email}}`, and `{{initial}}` are replaced with the signed-in user's details. Any element with `data-action="logout"` triggers the sign-out flow.

```html
<nextgen-logout proxy-base="/__nextgen" post-sign-out-url="/login">
  <template>
    <button data-action="logout">Sign out {{name}}</button>
  </template>
</nextgen-logout>
```

## Usage with Next.js

Wrap the component in a client-only boundary to avoid SSR issues:

```tsx
// app/login/widget.tsx
'use client';
import dynamic from 'next/dynamic';

const NextgenLogin = dynamic(
  async () => {
    await import('@nextgen/ui-lit');
    return function NextgenLoginElement() {
      return <nextgen-login proxy-base="/__nextgen" post-sign-in-url="/admin" />;
    };
  },
  { ssr: false },
);
```

## Usage with Nuxt

Use `<ClientOnly>` to avoid SSR issues:

```vue
<template>
  <ClientOnly>
    <nextgen-login proxy-base="/__nextgen" post-sign-in-url="/admin" />
  </ClientOnly>
</template>

<script setup lang="ts">
import '@nextgen/ui-lit';
</script>
```
