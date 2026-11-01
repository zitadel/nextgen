/**
 * Scaffolded guidance for humans (`README.md`) and agents (`AGENTS.md`):
 * the golden journey from a fresh scaffold to a customized, published
 * login — so the project explains its own next step without the docs
 * site. Both files are edited via a marker-fenced managed section, so
 * setup never clobbers what a developer (or another tool) wrote and a
 * rerun replaces only its own section.
 */
import { publicCliCommand } from "../../../public-cli";
import type { PatchContext } from "../types";

const MARKER_BEGIN = "<!-- zitadel:guidance:begin -->";
const MARKER_END = "<!-- zitadel:guidance:end -->";

/**
 * Insert or replace the managed guidance section in `source`. A missing
 * file becomes `header` + section; an existing section (marker pair) is
 * replaced in place; anything else gets the section appended. Pure and
 * idempotent — the file-writer skips the write when output equals input.
 */
export function upsertGuidanceSection(
  source: string | undefined,
  section: string,
  header: string,
): string {
  const block = `${MARKER_BEGIN}\n${section}\n${MARKER_END}\n`;
  if (source === undefined || source.trim() === "") {
    return `${header}${block}`;
  }
  const begin = source.indexOf(MARKER_BEGIN);
  const end = source.indexOf(MARKER_END);
  if (begin !== -1 && end > begin) {
    return `${source.slice(0, begin)}${block}${source.slice(end + MARKER_END.length).replace(/^\n/, "")}`;
  }
  return `${source.replace(/\n*$/, "\n\n")}${block}`;
}

/**
 * Remove the managed guidance section (markers inclusive) from `source` —
 * the inverse of {@link upsertGuidanceSection}, for `eject`. Content outside
 * the markers is preserved byte-for-byte; a missing or malformed marker pair
 * returns `source` unchanged.
 */
export function removeGuidanceSection(source: string): string {
  const begin = source.indexOf(MARKER_BEGIN);
  const end = source.indexOf(MARKER_END);
  if (begin === -1 || end <= begin) {
    return source;
  }
  return `${source.slice(0, begin)}${source.slice(end + MARKER_END.length).replace(/^\n/, "")}`;
}

/** The agent-facing golden path, written into `AGENTS.md`. */
export function agentsGuidanceSection(ctx: PatchContext): string {
  const deployDryRun = publicCliCommand("deploy --dry-run", ctx.cliVersion);
  const deploy = publicCliCommand("deploy", ctx.cliVersion);
  const movePort = movePortCommand(ctx);
  // WebAuthn ceremonies need an OS-level authenticator, so an agent driving
  // an automated browser stalls on the primary action of a passkey-first
  // flow unless told how to verify around it.
  const passkeyVerifyNote =
    ctx.preset === "passkey-first"
      ? " Agents: automated browsers can't complete passkey ceremonies — verify the loop via the email/password fallback actions, or attach a CDP WebAuthn virtual authenticator."
      : "";
  // JSX typing is a Next/React concern; other frameworks type the elements
  // through their own SDK wrappers, so the pointer would be misleading there.
  const jsxTypesNote =
    ctx.framework.id === "next"
      ? " React JSX types for the `<zitadel-*>` elements ship with the SDK — `custom-elements.d.ts` references `@zitadel/sdk-next/jsx`."
      : "";
  // Describe the posture the pages were actually emitted with (ADR 044), so
  // the guidance never claims full-page chrome an embedded card doesn't have.
  const presentationParagraph =
    ctx.posture === "widget"
      ? 'Presentation, by contrast, is edited in the generated pages: this app pre-dates setup, so they embed the sign-in widgets as `variant="widget"` cards (with `theme="auto"`) inside your existing layout; switch to `variant="page"` for the widget\'s own full-page chrome, and set `theme` (`light` | `dark` | `auto`) to pick the color scheme — `auto` follows the OS `prefers-color-scheme`, not this app\'s own theme, so pin `light` or `dark` when the app fixes its scheme.'
      : 'Presentation, by contrast, is edited in the generated pages: they pin the sign-in widgets to `variant="page"` (full-page chrome); switch to `variant="widget"` to embed a card inside your own layout, and set `theme` (`light` | `dark` | `auto`) to pick the color scheme — `auto` follows the OS `prefers-color-scheme`, not this app\'s own theme, so pin `light` or `dark` when the app fixes its scheme.';
  // The stable tokens and the forwarded parts are the embedding levers, and
  // they live nowhere an integrator would otherwise look (component source).
  // The docs list their names, so this points there instead of keeping a
  // copy that drifts.
  const themingParagraph =
    "Theming the widgets from your app: two hooks in your own stylesheet reach into their shadow DOM — the stable `--zl-*` design tokens, set on the element, and the parts `<zitadel-login>` forwards from its inner components as `zitadel-login::part(<atom>-<part>)` (the `card` part of `zl-card` is `zitadel-login::part(card-card)`). Both are listed under \"Style the login from your app\" in https://preview.zitadel.com/docs/guides/customize-design#style-the-login-from-your-app; any other `--zl-*` variable is internal. When your page already carries the heading, set the `suppress-header` attribute on `<zitadel-login>` / `<zitadel-session>` (SDK wrappers: `suppressHeader`) to visually hide the widget's own heading block — it stays in the accessibility tree. The login moves between sign-in and sign-up by itself (its own switch link, and an email it does or does not know), so a heading of your own must follow its `zitadel-flow-step` event, which the SDK wrappers forward: `step.purpose` is `login` while it signs in and `register` while it signs up. When it switches without being asked, the login tells the visitor why itself. To only reword the widget's heading, pass `locales` instead. Page layout around the widget (split screens, hero panes, marketing copy) is your app's code, not a Zitadel template.";
  // The app's own chrome (header nav, account menus) needs a session read of
  // its own — the widgets render their surfaces but never tell the host page
  // whether someone is signed in. Name the framework's supported read path;
  // the contract details live with each helper's own docs.
  const sessionStateParagraph =
    ctx.framework.id === "next"
      ? "Your app's own chrome (header navigation, account menus) reads session state with `getSession({ projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID })` from `@zitadel/sdk-next/session` — a no-store client read of the same-origin `/__nextgen/api/v1/sessions/me?project_id=…` that the session card itself uses. It returns identity only for 200 with a non-empty `user_id` in this app's project, and signed-out for the backend's canonical `401/auth.unauthorized`, `403/sess.project_mismatch` (a session of another project on the same host, such as the console's on localhost) or `404/sess.not_found`; any other response is unknown/error, never signed-out. In Server Components, `auth()` from `@zitadel/sdk-next/server` works too, on every page: the request boundary's `matcher` covers every route, which also makes `protectedRoutes` the one list of routes that need a sign-in (a protected route that a narrower `matcher` leaves out stays public). Sign-in and sign-out navigate (`post-sign-in-url` / `post-sign-out-url`), so chrome re-reads on the next page load without extra wiring."
      : ctx.framework.id === "nuxt"
        ? "Your app's own chrome (header navigation, account menus) reads session state with the auto-imported `useAuth()` composable — seeded from the server on every render by the scaffolded auth plugin. Sign-in and sign-out navigate (`post-sign-in-url` / `post-sign-out-url`), so the state is fresh on every page load."
        : 'Your app\'s own chrome (header navigation, account menus) can read session state from the same-origin `/__nextgen/api/v1/sessions/me?project_id=<project id>`, naming the project id the app passes to `configureZitadel()` — the same server-answered read the session card performs. Fetch with `credentials: "include"`, `cache: "no-store"`, and `Accept: application/json`; treat 200 as signed-in only with a non-empty `user_id` and that `project_id`, and signed-out only for the canonical error envelope `401/auth.unauthorized`, `403/sess.project_mismatch` (a session of another project on the same host, such as the console\'s on localhost) or `404/sess.not_found`. Any other response is unknown/error, never signed-out. Sign-in and sign-out navigate (`post-sign-in-url` / `post-sign-out-url`), so chrome re-reads on the next page load.';
  // Where sign-in lands is otherwise only in the SDK's type comments, so an
  // app that protects a checkout cannot tell whether the visitor returns to it.
  const returnPathParagraph =
    "After sign-in the login goes to the path in its page's `?next=` parameter, ahead of `post-sign-in-url`, so a visitor a protected route sent to sign in lands back on that route; a page of your own can read `next` to tell them why they must sign in. Set `force-post-sign-in-url` (SDK wrappers: `forcePostSignInUrl`) on a login whose page uses `next` for something else.";
  return `## Authentication (Zitadel)

This app's login is managed by Zitadel. Local config is the source of truth for what the login collects and how sign-in works (step 3 below). The app files setup generated are yours to change, from the pages to the request boundary that protects routes in a server-rendered app: \`doctor\` reports a file you changed as \`edited\`, or as \`adopted\` once you delete its \`zitadel-cli: managed-file\` comment, and \`doctor --fix\` restores only a missing file, never one you changed.

The golden path:

1. Start the dev server and open ${ctx.issuer}/login — **exactly this origin, not 127.0.0.1**. Passkeys and the origin allowlist are bound to it. (Freshly scaffolded apps also redirect / there; pre-existing apps keep their homepage.)
   - Port taken (\`EADDRINUSE\`) or another port wanted: run \`${movePort}\`. It moves the dev script or dev-server config, \`ZITADEL_ISSUER\` and the project's allowed origin together; changing only one of them breaks sign-in.
2. Prove the loop in a real browser: register a user → sign out → sign in → /profile shows signed in.${passkeyVerifyNote}
3. Customize by editing local config:
   - \`.zitadel/schemas/*.json\` — what a user is (fields, required, auth methods). See \`.zitadel/schemas/README.md\`.
   - \`.zitadel/flows/*.json\` — which screen collects which field/credential and how steps transition. See \`.zitadel/flows/README.md\`.
4. Preview, then publish:
   - \`${deployDryRun}\`
   - \`${deploy}\`
   - Agents: run both with \`--non-interactive\`; the publish also needs \`-m "<why this release changes>"\`, because a non-interactive \`deploy\` requires a message (\`--dry-run\` is exempt). \`deploy --dry-run\` validates flow invariants with the server's own rules and prints the diff **before** anything uploads — fix what it reports and re-run. Leave \`--json\` off the dry run to see that diff: its envelope carries only what would be published.

${presentationParagraph}${jsxTypesNote}

${themingParagraph}

${sessionStateParagraph}

${returnPathParagraph}

Machine-readable dialect (read these before authoring flow or schema edits):

- \`zitadel.json\` carries \`"$schema": "./.zitadel/meta/project.json"\`, the schema of the project configuration.
- Flow files carry \`"$schema": "../meta/flow-definition.json"\` — the flow dialect spec (steps, actions and their kinds, transitions, reserved outcomes like \`user_not_found\`). Editors validate against it.
- \`.zitadel/meta/user-schema.json\` (with its companions \`user-property.json\`, \`auth-methods.json\`, \`auth-method.json\`, \`sso-auth-method.json\`) specifies the user-schema dialect (\`x-auth-methods\`, \`x-unique\`, property constraints).
- \`.zitadel/meta/idp-connection.json\` specifies a provider connection file under \`.zitadel/idps/\` (protocol block, credentials as \`\${{ NAME }}\` variable references, claim mapping). A user schema lists the connection slugs it allows under \`x-auth-methods.sso.providers\`.
- The files in \`.zitadel/meta/\` are generated by the CLI; do not edit them. After upgrading the CLI, run the new version's \`doctor --fix\` (\`npx @zitadel/cli@<version> doctor --fix\`) to write its schemas.
- Worked flow examples: https://github.com/zitadel/nextgen/tree/main/api/openapi/endpoints/flow_definitions/examples

Never edit \`.zitadel/state.json\` (sync bookkeeping) or \`.zitadel/secret\` (credentials, git-ignored). Keep \`.zitadel/local/\` out of source control.`;
}

/** The human-facing summary appended to the app `README.md`. */
export function readmeGuidanceSection(ctx: PatchContext): string {
  const deployDryRun = publicCliCommand("deploy --dry-run", ctx.cliVersion);
  const deploy = publicCliCommand("deploy", ctx.cliVersion);
  const movePort = movePortCommand(ctx);
  return `## Authentication (Zitadel)

Login for this app is managed by [Zitadel](https://zitadel.com). Try it: start the dev server, open ${ctx.issuer}/login (use this exact origin — passkeys are bound to it), register a user, sign out, and sign in again.

If the dev server's port is taken (\`EADDRINUSE\`), or you want another one, move the app with \`${movePort}\`: it updates the dev script, \`ZITADEL_ISSUER\` and the project's allowed origin together.

The dev server keeps its terminal busy, so run the commands below from a second terminal in this directory.

To change what the login collects or how sign-in works, edit the files under \`.zitadel/schemas/\` and \`.zitadel/flows/\` (each folder has a README), then:

\`\`\`sh
${deployDryRun}
${deploy}
\`\`\``;
}

/** The command that moves the app to another dev port, `<port>` left to fill in. */
function movePortCommand(ctx: PatchContext): string {
  return publicCliCommand("setup --dev-port <port>", ctx.cliVersion);
}

/** Full-file header used when `AGENTS.md` does not exist yet. */
export const AGENTS_HEADER = `# AGENTS.md

Guidance for AI agents working in this repository.

`;

/** Full-file header used when `README.md` does not exist yet. */
export const README_HEADER = "";
