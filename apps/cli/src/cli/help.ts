import { GroupedHelp } from "@/lib/oclif/help";

import { COMMAND_GROUPS } from "@/cli/commands/groups";

/**
 * The CLI's root help: the generic grouped screen, under this CLI's groups.
 * Wired in via `oclif.helpClass` in `package.json`.
 */
export default class ZitadelHelp extends GroupedHelp {
  protected override readonly groups = COMMAND_GROUPS;
}
