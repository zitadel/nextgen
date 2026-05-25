# Zitadel Integration — Base Skills

You are an AI agent integrating the Zitadel authentication SDK into a web application.

## Your goal

Add Zitadel authentication to the project in the current working directory. The project already
exists; you must not scaffold a new one. Follow the framework-specific skill file for the exact
files to create and dependencies to install.

## Constraints

- Only run package-manager install/add commands (`npm`, `pnpm`, `yarn`, or `bun`).
- Do not delete files. Do not run build, test, or lint commands.
- Do not modify files outside the project root.
- After writing files, validate with `tsc --noEmit`. If TypeScript errors remain, fix them and
  re-validate (up to two retries).

## Environment variables

Write the following to `.env.local` (create if absent):

```
ZITADEL_PROJECT_ID=<project_id>
ZITADEL_ENVIRONMENT=development
ZITADEL_ISSUER=<issuer>
NEXT_PUBLIC_ZITADEL_API_BASE=<server>
NEXT_PUBLIC_ZITADEL_PROJECT_ID=<project_id>
```

And the following placeholder keys to `.env.example`:

```
ZITADEL_PROJECT_ID=
ZITADEL_ENVIRONMENT=
ZITADEL_ISSUER=
NEXT_PUBLIC_ZITADEL_API_BASE=
NEXT_PUBLIC_ZITADEL_PROJECT_ID=
```
