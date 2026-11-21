import { cliSetup } from "@/components/cli-hint";
import { CopyBlock } from "@/components/copy-block";
import { trackEvent } from "@/addon/analytics";
import { serverOrigin } from "@/api/server-origin";

/**
 * The CLI's `setup` command, naming this console's server, with its copy
 * button: how a project is created, wherever the console says so.
 */
export function SetupCommand() {
  return (
    <CopyBlock
      prompt
      value={cliSetup(serverOrigin())}
      label="Copy the setup command"
      // The console's one call to action: the copy is what reaches the
      // terminal, so it is reported (addon/analytics.ts).
      onCopied={() => trackEvent("copied_command", { page: "projects", snippet: "setup" })}
    />
  );
}
