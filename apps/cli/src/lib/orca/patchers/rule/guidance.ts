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
  const plan = publicCliCommand("plan", ctx.cliVersion);
  const apply = publicCliCommand("apply", ctx.cliVersion);
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
      ? 'Presentation, by contrast, is edited in the generated pages: this app pre-dates setup, so they embed the sign-in widgets as `variant="widget"` cards (with `theme="auto"`) inside your existing layout; switch to `variant="page"` for the widget\'s own full-page chrome, and set `theme` (`light` | `dark` | `auto`) to pick the color scheme.'
      : 'Presentation, by contrast, is edited in the generated pages: they pin the sign-in widgets to `variant="page"` (full-page chrome); switch to `variant="widget"` to embed a card inside your own layout, and set `theme` (`light` | `dark` | `auto`) to pick the color scheme.';
  // The app's own chrome (header nav, account menus) needs a session read of
  // its own — the widgets render their surfaces but never tell the host page
  // whether someone is signed in. Name the framework's supported read path;
  // the contract details live with each helper's own docs.
  const sessionStateParagraph =
    ctx.framework.id === "next"
      ? "Your app's own chrome (header navigation, account menus) reads session state with `getSession()` from `@zitadel/sdk-next/session` — a no-store client read of the same-origin `/__nextgen/sessions/me` that the session card itself uses. It returns identity only for 200 with a non-empty `user_id`, and signed-out only for the backend's canonical `401/auth.unauthorized` or `404/sess.not_found`; any other response is unknown/error, never signed-out. In Server Components on routes covered by the request-boundary `matcher`, `auth()` from `@zitadel/sdk-next/server` works too. Sign-in and sign-out navigate (`post-sign-in-url` / `post-sign-out-url`), so chrome re-reads on the next page load without extra wiring."
      : ctx.framework.id === "nuxt"
        ? "Your app's own chrome (header navigation, account menus) reads session state with the auto-imported `useAuth()` composable — seeded from the server on every render by the scaffolded auth plugin. Sign-in and sign-out navigate (`post-sign-in-url` / `post-sign-out-url`), so the state is fresh on every page load."
        : 'Your app\'s own chrome (header navigation, account menus) can read session state from the same-origin `/__nextgen/sessions/me` — the same server-answered read the session card performs. Fetch with `credentials: "include"`, `cache: "no-store"`, and `Accept: application/json`; treat 200 as signed-in only with a non-empty `user_id`, and signed-out only for the canonical error envelope `401/auth.unauthorized` or `404/sess.not_found`. Any other response is unknown/error, never signed-out. Sign-in and sign-out navigate (`post-sign-in-url` / `post-sign-out-url`), so chrome re-reads on the next page load.';
  return `## Authentication (Zitadel)

This app's login is managed by Zitadel. Local config is the source of truth; never change auth behavior by editing generated route files.

The golden path:

1. Start the dev server and open ${ctx.issuer}/login — **exactly this origin, not 127.0.0.1**. Passkeys and the origin allowlist are bound to it. (Freshly scaffolded apps also redirect / there; pre-existing apps keep their homepage.)
2. Prove the loop in a real browser: register a user → sign out → sign in → /profile shows signed in.${passkeyVerifyNote}
3. Customize by editing local config:
   - \`.zitadel/schemas/*.json\` — what a user is (fields, required, auth methods). See \`.zitadel/schemas/README.md\`.
   - \`.zitadel/flows/*.json\` — which screen collects which field/credential and how steps transition. See \`.zitadel/flows/README.md\`.
4. Preview, then publish:
   - \`${plan}\`
   - \`${apply}\`
   - Agents: append \`--non-interactive --json\` to both. \`plan\` validates flow invariants with the server's own rules **before** anything uploads — fix what it reports and re-run.

${presentationParagraph}${jsxTypesNote}

${sessionStateParagraph}

Machine-readable dialect (read these before authoring flow or schema edits):

- Flow files carry \`"$schema": "../meta/flow-definition.json"\` — the flow dialect spec (steps, actions and their kinds, transitions, reserved outcomes like \`user_not_found\`). Editors validate against it.
- \`.zitadel/meta/user-schema.json\` (with its companions \`user-property.json\`, \`auth-methods.json\`, \`auth-method.json\`) specifies the user-schema dialect (\`x-auth-methods\`, \`x-unique\`, property constraints).
- Worked flow examples: https://github.com/zitadel/nextgen/tree/main/api/openapi/endpoints/flow_definitions/examples

Never edit \`.zitadel/state.json\` (sync bookkeeping) or \`.zitadel/secret\` (credentials, git-ignored). Keep \`.zitadel/local/\` out of source control.`;
}

/** The human-facing summary appended to the app `README.md`. */
export function readmeGuidanceSection(ctx: PatchContext): string {
  const plan = publicCliCommand("plan", ctx.cliVersion);
  const apply = publicCliCommand("apply", ctx.cliVersion);
  return `## Authentication (Zitadel)

Login for this app is managed by [Zitadel](https://zitadel.com). Try it: start the dev server, open ${ctx.issuer}/login (use this exact origin — passkeys are bound to it), register a user, sign out, and sign in again.

To change what the login collects or how sign-in works, edit the files under \`.zitadel/schemas/\` and \`.zitadel/flows/\` (each folder has a README), then:

\`\`\`sh
${plan}
${apply}
\`\`\``;
}

/** Full-file header used when `AGENTS.md` does not exist yet. */
export const AGENTS_HEADER = `# AGENTS.md

Guidance for AI agents working in this repository.

`;

/** Full-file header used when `README.md` does not exist yet. */
export const README_HEADER = "";
