import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "../../theme";

/**
 * The app-wide toaster.
 *
 * Adapted from the shadcn registry component in one respect: the registry
 * version reads the theme from `next-themes`, which this app does not use. The
 * console drives `data-theme` on `<html>` itself (`src/theme.ts`), so the
 * resolved theme comes from that hook instead — adding `next-themes` would put
 * a second, competing source of truth for the theme in the bundle.
 *
 * Sonner renders in a portal outside the app subtree, so it cannot inherit the
 * token values through the cascade the way the rest of the UI does. The `style`
 * block below maps its private custom properties onto the same semantic tokens
 * (`--color-popover`, `--color-border`) every other surface uses, so it flips with
 * `data-theme` rather than needing a light and a dark variant.
 *
 * The design system's toast is 336px wide with a 20px icon, 8px before 14/20
 * medium text; sonner's own sheet draws 356px, a 16px icon with its own
 * margins, 6px and 13px, so each is set here. The important suffixes beat
 * the sheet's `[data-sonner-toast]` rules, which carry the same specificity.
 */
const TOAST = "gap-2! text-sm!";
const TOAST_TITLE = "text-sm! leading-5! font-medium";
const TOAST_ICON = "m-0! size-5! [&_svg]:size-5";
function Toaster({ ...props }: ToasterProps) {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        // Filled, with the check cut out of it, as the design system draws it.
        success: <CircleCheckIcon className="size-5 fill-popover-foreground stroke-popover" />,
        info: <InfoIcon className="size-5" />,
        warning: <TriangleAlertIcon className="size-5" />,
        error: <OctagonXIcon className="size-5" />,
        loading: <Loader2Icon className="size-5 animate-spin" />,
      }}
      toastOptions={{ classNames: { toast: TOAST, title: TOAST_TITLE, icon: TOAST_ICON } }}
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius-md)",
          "--width": "336px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
