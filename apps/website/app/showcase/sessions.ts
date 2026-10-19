import type { Screen, Session } from "./types";

// The login's screens the steps show, drawn live from its atoms
// (login-preview.tsx) in the default template's English copy
// (packages/components/src/orchestrator/locales/en.ts), with the fields the
// recorded session's pages had: the sign-in setup serves, the registration
// form before and after the schema change, and the sign-in after the flow
// change, which the brand row themes.
const email = {
  label: "Email",
  type: "email",
  placeholder: "you@example.com",
  required: true,
} as const;

const signIn: Screen = {
  title: "Sign in",
  subtitle: "Enter your email to continue",
  fields: [email],
  action: "Continue",
  nav: { lead: "Don't have an account? ", link: "Sign up" },
};

const register: Screen = {
  title: "Create your account",
  subtitle: "Enter your details to get started",
  fields: [email],
  action: "Continue with password",
  nav: { lead: "Already have an account? ", link: "Sign in" },
};

export const signInWithPassword: Screen = {
  ...signIn,
  fields: [email, { label: "Password", type: "password", required: true }],
};

// The showcase's recorded steps, from zitadel/new-website's narrative redesign
// (its homepage's terminalSection, a session recorded with `script` on
// 5 October 2026 with @zitadel/cli 1.0.0-alpha.24, the hero's commands with
// `doctor` first): the first step is what that session's start printed, with
// the one-time console link masked; the second the files its setup wrote (the
// rest it summed up as "env, project config, the editable user schema and
// login flow"); the next two its recorded diffs and command output. The pages
// beside them are the screens above, as that session's app served them.
// Re-record rather than edit when the CLI changes (AGENTS.md). The last step,
// the brand, is live (brand-row.tsx).
export const sessions: Session[] = [
  {
    label: "Start Zitadel",
    description:
      "`start` runs Zitadel on your machine and signs you in to its console. Users, passwords and sessions live there, not in your app.",
    recording: {
      title: "myapp",
      command: "npx @zitadel/cli@alpha start",
      output: [
        "Console: signed in as admin@zitadel.localhost. Open this link (works once):",
        "http://localhost:8080/ui/console/login?handoff=…",
        "Local Zitadel server is ready.",
        "(server: localhost:8080)",
      ],
    },
  },
  {
    label: "Add the login",
    description:
      "`setup` writes the login pages into your app, with your user model and login flow as files beside them. `npm run dev` serves them.",
    scaffold: {
      root: "myapp",
      entries: [
        { path: "app/login/page.tsx", note: "Login page" },
        { path: "app/register/page.tsx", note: "Registration page" },
        { path: "app/profile/page.tsx", note: "Profile page" },
        { path: "proxy.ts", note: "Next.js proxy" },
        {
          path: ".zitadel/schemas/default-human-user.json",
          note: "User model",
          highlight: true,
        },
        { path: ".zitadel/flows/default-login.json", note: "Login flow", highlight: true },
      ],
      rest: "+ package.json, .env.local, zitadel.json and more",
    },
    result: { url: "localhost:3000/login", screen: signIn },
  },
  {
    label: "Add a field",
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
      before: register,
      screen: { ...register, fields: [email, { label: "Company" }] },
    },
  },
  {
    label: "Change the flow",
    description:
      "Change what a step asks for and where it goes next, plan, apply. The login follows.",
    artifact: {
      // After the change the identifier step asks for the password too: its
      // pill shows it, or the flow would look like it lost the password.
      graph: {
        before: ["identifier", "password", "done"],
        after: [{ name: "identifier", adds: "password" }, "done"],
      },
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
    result: { url: "localhost:3000/login", before: signIn, screen: signInWithPassword },
  },
];
