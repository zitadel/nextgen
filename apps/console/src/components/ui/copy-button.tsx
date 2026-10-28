import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The button and its glyph per size: the design draws a 14px glyph in a
 * toolbar, 12px in a 24px box beside a field, and 12px in a 16px box beside
 * a value in a row or a cell, where the button must not drive the line
 * height.
 */
const SIZE = {
  sm: { button: "sm", icon: "size-3.5", className: "" },
  "icon-xs": { button: "icon-xs", icon: "size-3", className: "" },
  inline: { button: "icon-xs", icon: "size-3", className: "size-4 shrink-0" },
} as const;

/** How long the tick stays before the button returns to its resting state. */
const CONFIRM_MS = 2000;

/**
 * Copy-to-clipboard control.
 *
 * The confirmation is an icon swap plus a live region: neither call site has
 * room for a label, and a silent icon change is invisible to a screen reader.
 * The button's own accessible name deliberately does *not* change on copy —
 * renaming a focused control is disorienting, and the live region is the
 * reliable way to announce the result.
 *
 * A write that is refused, or a missing clipboard (both happen on an insecure
 * origin), leaves the button in its resting state rather than claiming a copy
 * that did not happen. The value is on screen and selectable either way, so a
 * failure needs no error surface.
 */
export function CopyButton({
  value,
  label,
  size = "icon-xs",
  className,
}: {
  value: string;
  /** The button's full accessible name, e.g. `Copy User ID`. */
  label: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={SIZE[size].button}
        className={cn(SIZE[size].className, className)}
        aria-label={label}
        onClick={() => {
          // `navigator.clipboard` is absent on an insecure origin. Guarded
          // explicitly rather than by optional-chaining the call: both are
          // safe, but the chain form reads as though `.then()` runs on
          // `undefined`.
          const { clipboard } = navigator;
          if (!clipboard) return;
          void clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? (
          <Check className={`${SIZE[size].icon} text-foreground`} aria-hidden />
        ) : (
          <Copy className={SIZE[size].icon} aria-hidden />
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
