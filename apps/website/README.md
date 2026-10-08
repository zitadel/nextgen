# @zitadel/website

Scaffold of the public website for the hosted preview cloud: a Next.js app
(App Router, React 19, Tailwind 4) with one start page. It is the `website`
service of the cloud deployment defined in the repo-root `vercel.json`, where
it owns `/` while the docs service owns `/docs` and the server owns the API
and the console.

The stack mirrors `zitadel/new-website` (`apps/website` there: Next.js,
Tailwind via `@tailwindcss/postcss`, `@zitadel/theme`) so that its pages and
content can move here. What is deliberately not here yet: the theme package,
fonts and favicons, the CSP and redirects from its `next.config.ts`,
analytics, MDX content.

```sh
corepack pnpm --filter @zitadel/website run dev        # http://localhost:3004
corepack pnpm --filter @zitadel/website run build
corepack pnpm --filter @zitadel/website run typecheck
```

Adding a top-level route to this app (a page at `/pricing`, a file in
`public/`) also needs a rewrite in `vercel.json`, because the server is the
catch-all; `/` and `/_next/*` are routed today. Once the website has real
routes, the plan is to move the server to its own hostname (route by host in
the same `vercel.json`) so the website can own every path.

Operations: [docs/runbooks/preview-cloud.md](../../docs/runbooks/preview-cloud.md).
