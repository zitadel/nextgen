import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Two deliberate departures from the registry default, both from the design
 * system's `Type=Input, State=Default` node:
 *
 * - **`bg-background`, not `bg-transparent`.** The design fills an input with
 *   `background`, a surface of its own. Stock shadcn leaves it transparent, so
 *   the field takes on whatever it is sitting on — indistinguishable from the
 *   page while an input is on the page, then visibly wrong the moment one is
 *   placed on a `Card`, which is every detail screen. Fixing it per screen is
 *   why the same note kept coming back; it belongs here, once.
 * - **`px-2.5`, not `px-3`.** The design insets 10px.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
