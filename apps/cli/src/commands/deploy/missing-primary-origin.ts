import { Cmd } from "../../lib/cmd";
import { issuerHeldAsPreview, originOf, type ProjectOrigin } from "../../lib/origins";
import type { SuggestedCommand } from "../../lib/suggestion";

type MissingPrimaryOrigin = {
  origins: ReadonlyArray<ProjectOrigin>;
  issuer: string | undefined;
  setupProject: boolean;
  suggest: (command: string) => SuggestedCommand;
};

/**
 * What a deploy with no primary origin to land on tells the developer, naming
 * the step that gives the project one. A project `zitadel setup` 0.1.0 created
 * holds its issuer as a preview origin, which `origin add --kind primary`
 * refuses as a conflict: `doctor --fix` makes it primary for the project
 * `.zitadel/secret` records, the one doctor repairs, and any other project
 * removes the pattern and adds it back. Otherwise the issuer is added as
 * primary, or the URL the developer fills in when no issuer resolves.
 */
export function missingPrimaryOrigin(input: MissingPrimaryOrigin): { hint: string; next: string } {
  const preview =
    input.issuer === undefined ? undefined : issuerHeldAsPreview(input.origins, input.issuer);
  if (preview !== undefined) {
    const held = `It holds its issuer ${preview} as a preview origin, as \`zitadel setup\` 0.1.0 registered it, so adding it as primary conflicts.`;
    if (input.setupProject) {
      return {
        hint: `${held} Run \`${input.suggest("doctor --fix")}\` to make it primary, then deploy.`,
        next: "doctor --fix",
      };
    }
    const remove = `origin rm ${Cmd.quote(preview)} --force`;
    const add = `origin add ${Cmd.quote(preview)} --kind primary`;
    return {
      hint: `${held} Remove it with \`${input.suggest(remove)}\`, add it back with \`${input.suggest(add)}\`, then deploy.`,
      next: remove,
    };
  }
  if (input.issuer !== undefined) {
    const add = `origin add ${Cmd.quote(originOf(input.issuer))} --kind primary`;
    return {
      hint: `Add the URL the app serves from with \`${input.suggest(add)}\`, then deploy.`,
      next: add,
    };
  }
  return {
    hint: `Add one with \`${input.suggest("origin add <url> --kind primary")}\`, then deploy.`,
    next: "origin list",
  };
}
