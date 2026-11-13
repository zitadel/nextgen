import { CopyButton } from "@/components/ui/copy-button";

/**
 * A value to take elsewhere, in a box with its copy button: a command for a
 * terminal (`prompt` draws the `$` before it), or a secret shown once.
 *
 * Wraps rather than scrolls: a value can outrun its box, and the button
 * copies it whole either way. `wrap-anywhere` breaks at a space first, so a
 * URL in a command stays in one piece unless it is longer than a line.
 */
export function CopyBlock({
  value,
  label,
  prompt = false,
  onCopied,
}: {
  value: string;
  /** The copy button's accessible name, e.g. `Copy the setup command`. */
  label: string;
  prompt?: boolean;
  /** Runs once the value is on the clipboard, such as to report the copy. */
  onCopied?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted pr-1 pl-3">
      {prompt && (
        <span aria-hidden className="py-1.5 font-mono text-xs leading-5 text-muted-foreground">
          $
        </span>
      )}
      <code className="min-w-0 flex-1 py-1.5 font-mono text-xs leading-5 text-foreground wrap-anywhere">
        {value}
      </code>
      <CopyButton value={value} label={label} size="sm" onCopied={onCopied} />
    </div>
  );
}
