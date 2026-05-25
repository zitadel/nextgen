# Next.js App Router — Zitadel Integration Skill

## Dependency

Install the SDK:

```
pnpm add @zitadel-nextgen/sdk-next@latest
```

## Files to create

### `app/login/page.tsx`

A client component that renders the `<zitadel-login>` web component for the login flow.
Import the component via `next/dynamic` with `ssr: false`.

### `app/register/page.tsx`

A client component that renders `<zitadel-login>` with `purpose="register"`.

### `app/profile/page.tsx`

A client component that renders `<zitadel-logout>` for signing out.

### `custom-elements.d.ts` (next to `app/`)

TypeScript ambient declarations for the `zitadel-login` and `zitadel-logout` custom elements
so that JSX does not produce type errors.

## Notes

- All pages must include the `// zitadel-cli: managed-file v1` marker as the first line.
- Use `NEXT_PUBLIC_ZITADEL_API_BASE` and `NEXT_PUBLIC_ZITADEL_PROJECT_ID` environment variables
  to configure the web components at runtime.
- Do not add a Next.js provider wrapper; the web components are self-contained.
