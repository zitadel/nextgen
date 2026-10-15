import loginAfterFlow from "./login-after-flow.jpg";
import loginAfterSetup from "./login-after-setup.jpg";
import registerAfterSchema from "./register-after-schema.jpg";
import registerBefore from "./register-before.jpg";
import type { Session } from "./types";

// The showcase's recorded rows, from zitadel/new-website's narrative redesign
// (its homepage's terminalSection, recorded with `script` on 5 October 2026
// with @zitadel/cli 1.0.0-alpha.24): the real output, with the scratch path
// shortened to "myapp", the one-time console link masked, and skipped lines
// marked as comments. The pictures are the scaffolded app's pages at 520px, as
// that session left them. Re-record rather than edit when the CLI changes
// (AGENTS.md). The fourth row, the brand, is live (brand-row.tsx).
export const sessions: Session[] = [
  {
    label: "Up in a minute",
    description:
      "Four commands, and a local Zitadel, login and registration pages in your app, and the app running.",
    recording: {
      title: "myapp",
      lines: [
        { type: "command", text: "mkdir myapp && cd myapp" },
        { type: "command", text: "npx @zitadel/cli@alpha doctor" },
        { type: "output", text: "Zitadel doctor passed." },
        { type: "output", text: "(server: localhost:8080)" },
        { type: "output", text: "Project: lifecycle=not-configured" },
        { type: "output", text: "Checks:" },
        {
          type: "output",
          text: "  [ok] server-binary: @zitadel/server 1.0.0-alpha.24 is available",
        },
        {
          type: "output",
          text: "  [ok] state-dir: myapp/.zitadel/local/nextgen-data can be created (myapp is writable)",
        },
        { type: "output", text: "  [ok] port: Port 8080 is available" },
        { type: "output", text: "  [ok] runtime: No existing runtime metadata" },
        {
          type: "output",
          text: "  [ok] managed-runtime-processes: No additional host-wide managed local runtime processes found.",
        },
        { type: "command", text: "npx @zitadel/cli@alpha start" },
        {
          type: "output",
          text: "Console: signed in as admin@zitadel.localhost. Open this link (works once):",
        },
        { type: "output", text: "http://localhost:8080/ui/console/login?handoff=…" },
        { type: "output", text: "Local Zitadel server is ready." },
        { type: "output", text: "(server: localhost:8080)" },
        { type: "output", text: "Next:" },
        {
          type: "output",
          text: "  From your app directory, run setup; the CLI will detect the framework or ask when needed.",
        },
        { type: "command", text: "npx @zitadel/cli@alpha setup --framework next --server local" },
        { type: "output", text: "◐ Detecting framework in myapp" },
        { type: "output", text: "ℹ Fresh app directory — scaffolding a fresh project" },
        { type: "output", text: "✔ Scaffolded next skeleton" },
        { type: "output", text: "✔ Detected next (dev port 3000)" },
        { type: "output", text: "◐ Creating project on http://localhost:8080" },
        { type: "output", text: "✔ Created project proj_01M47Q1JG830SMMH0J71X03R0E" },
        { type: "output", text: "◐ Patching project files" },
        { type: "output", text: "ℹ Wrote the login page (app/login/page.tsx)" },
        { type: "output", text: "ℹ Wrote the registration page (app/register/page.tsx)" },
        { type: "output", text: "ℹ Wrote the profile page (app/profile/page.tsx)" },
        { type: "output", text: "ℹ Wrote the Next.js proxy (proxy.ts)" },
        { type: "output", text: "ℹ Wrote package.json with the SDK dependency (package.json)" },
        {
          type: "comment",
          text: "  … 22 more files: env, project config, the editable user schema and login flow",
        },
        { type: "output", text: "✔ Patched 27 files (1 unchanged)" },
        { type: "output", text: "◐ Installing dependencies with npm install" },
        { type: "output", text: "✔ Installed dependencies" },
        {
          type: "output",
          text: "✔ Project owned by admin@zitadel.localhost (team team_localadmin)",
        },
        { type: "output", text: "Zitadel is ready" },
        { type: "output", text: "Start your project (then open http://localhost:3000/login):" },
        { type: "output", text: "  npm run dev" },
        { type: "command", text: "npm run dev" },
        { type: "output", text: "▲ Next.js 16.2.4 (Turbopack)" },
        { type: "output", text: "- Local:         http://localhost:3000" },
        { type: "output", text: "- Environments: .env.local" },
        { type: "output", text: "✓ Ready in 153ms" },
        {
          type: "output",
          text: " GET /login 200 in 958ms (next.js: 895ms, application-code: 63ms)",
        },
        {
          type: "comment",
          text: "# open http://localhost:3000/login and register your first user",
        },
      ],
    },
    result: {
      url: "localhost:3000/login",
      image: { src: loginAfterSetup, alt: "The sign-in card the setup wrote, served by the app" },
    },
  },
  {
    label: "Your fields",
    description:
      "Add a property to the user schema, ask for it on the registration step, plan, apply. The form shows it.",
    artifact: {
      files: [
        {
          path: ".zitadel/schemas/default-human-user.json",
          lines: [
            { type: "context", text: '  "properties": {' },
            { type: "added", text: '    "company": {' },
            { type: "added", text: '      "type": "string",' },
            { type: "added", text: '      "description": "The user\'s company."' },
            { type: "added", text: "    }" },
          ],
        },
        {
          path: ".zitadel/flows/default-login.json",
          lines: [
            { type: "context", text: '      "fields": [' },
            { type: "removed", text: '        "email"' },
            { type: "added", text: '        "email",' },
            { type: "added", text: '        "company"' },
            { type: "context", text: "      ]," },
          ],
        },
      ],
      commands: [
        { command: "npx @zitadel/cli@alpha plan", output: "Plan: 2 new revisions." },
        {
          command: "npx @zitadel/cli@alpha apply",
          output: "✔ Sync complete. Changes are live — reload your app to see them.",
        },
      ],
    },
    result: {
      url: "localhost:3000/register",
      before: { src: registerBefore, alt: "The registration form before the schema change" },
      image: { src: registerAfterSchema, alt: "The registration form with the new company field" },
    },
  },
  {
    label: "Your flow",
    description:
      "Change what a step asks for and where it goes next, plan, apply. The login follows.",
    artifact: {
      graph: { before: ["identifier", "password", "done"], after: ["identifier", "done"] },
      files: [
        {
          path: ".zitadel/flows/default-login.json",
          lines: [
            { type: "context", text: '      "fields": [' },
            { type: "removed", text: '        "email"' },
            { type: "added", text: '        "email",' },
            { type: "added", text: '        "x-auth-methods#password"' },
            { type: "context", text: "      ]," },
            { type: "context", text: '      "name": "identifier",' },
            { type: "context", text: '      "submit": {' },
            { type: "removed", text: '        "target": "password"' },
            { type: "added", text: '        "target": "done"' },
            { type: "context", text: "      }," },
          ],
        },
      ],
      commands: [
        { command: "npx @zitadel/cli@alpha plan", output: "Plan: 1 new revision." },
        {
          command: "npx @zitadel/cli@alpha apply",
          output: "✔ Sync complete. Changes are live — reload your app to see them.",
        },
      ],
    },
    result: {
      url: "localhost:3000/login",
      before: {
        src: loginAfterSetup,
        alt: "The login before the flow change, asking for the email only",
      },
      image: {
        src: loginAfterFlow,
        alt: "The sign-in card asking for email and password on one screen",
      },
    },
  },
];
