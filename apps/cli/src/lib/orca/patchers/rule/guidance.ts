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
  return `## Authentication (Zitadel)

This app's login is managed by Zitadel. Local config is the source of truth; never change auth behavior by editing generated route files.

The golden path:

1. Start the dev server and open ${ctx.issuer} — **exactly this origin, not 127.0.0.1**. Passkeys and the origin allowlist are bound to it.
2. Prove the loop in a real browser: register a user → sign out → sign in → /profile shows signed in.
3. Customize by editing local config:
   - \`.zitadel/schemas/*.json\` — what a user is (fields, required, auth methods). See \`.zitadel/schemas/README.md\`.
   - \`.zitadel/flows/*.json\` — which screen collects which field/credential and how steps transition. See \`.zitadel/flows/README.md\`.
4. Preview, then publish:
   - \`${plan}\`
   - \`${apply}\`
   - Agents: append \`--non-interactive --json\` to both. \`plan\` validates flow invariants with the server's own rules **before** anything uploads — fix what it reports and re-run.

Machine-readable dialect (read these before authoring flow or schema edits):

- Flow files carry \`"$schema": "../meta/flow-definition.json"\` — the flow dialect spec (steps, actions and their kinds, transitions, reserved outcomes like \`user_not_found\`). Editors validate against it.
- \`.zitadel/meta/user-schema.json\` and \`.zitadel/meta/user-property.json\` specify the user-schema dialect (\`x-auth-methods\`, \`x-unique\`, property constraints).
- Worked flow examples: https://github.com/zitadel/nextgen/tree/main/api/openapi/endpoints/flow_definitions/examples

Never edit \`.zitadel/state.json\` (sync bookkeeping) or \`.zitadel/secret\` (credentials, git-ignored). Keep \`.zitadel/local/\` out of source control.`;
}

/** The human-facing summary appended to the app `README.md`. */
export function readmeGuidanceSection(ctx: PatchContext): string {
  const plan = publicCliCommand("plan", ctx.cliVersion);
  const apply = publicCliCommand("apply", ctx.cliVersion);
  return `## Authentication (Zitadel)

Login for this app is managed by [Zitadel](https://zitadel.com). Try it: start the dev server, open ${ctx.issuer} (use this exact origin — passkeys are bound to it), register a user, sign out, and sign in again.

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
