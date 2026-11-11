import { cliSetup } from "@/components/cli-hint";
import { CopyButton } from "@/components/ui/copy-button";
import { trackEvent } from "@/addon/analytics";
import { serverOrigin } from "@/api/server-origin";

/**
 * The CLI's `setup` command, naming this console's server, with its copy
 * button: how a project is created, wherever the console says so.
 *
 * Wraps rather than scrolls: a `--server` origin can outrun its box, and the
 * button copies the command whole either way. `wrap-anywhere` breaks at a
 * space first, so the origin stays in one piece unless it is longer than a
 * line.
 */
export function SetupCommand() {
  const command = cliSetup(serverOrigin());

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted pr-1 pl-3">
      <span aria-hidden className="py-1.5 font-mono text-xs leading-5 text-muted-foreground">
        $
      </span>
      <code className="min-w-0 flex-1 py-1.5 font-mono text-xs leading-5 text-foreground wrap-anywhere">
        {command}
      </code>
      {/* The console's one call to action: the copy is what reaches the
          terminal, so it is reported (addon/analytics.ts). */}
      <CopyButton
        value={command}
        label="Copy the setup command"
        size="sm"
        onCopied={() => trackEvent("copied_command", { page: "projects", snippet: "setup" })}
      />
    </div>
  );
}
