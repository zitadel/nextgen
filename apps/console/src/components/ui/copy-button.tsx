import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

/** Icon size per button size — the design draws 14px in a toolbar, 12px inline. */
const ICON_SIZE = { sm: "size-3.5", "icon-xs": "size-3" } as const

/** How long the tick stays before the button returns to its resting state. */
const CONFIRM_MS = 2000

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
}: {
  value: string
  /** The button's full accessible name, e.g. `Copy User ID`. */
  label: string
  size?: keyof typeof ICON_SIZE
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-label={label}
        onClick={() => {
          // `navigator.clipboard` is absent on an insecure origin. Guarded
          // explicitly rather than by optional-chaining the call: both are
          // safe, but the chain form reads as though `.then()` runs on
          // `undefined`.
          const { clipboard } = navigator
          if (!clipboard) return
          void clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }}
      >
        {copied ? (
          <Check className={`${ICON_SIZE[size]} text-foreground`} aria-hidden />
        ) : (
          <Copy className={ICON_SIZE[size]} aria-hidden />
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  )
}
