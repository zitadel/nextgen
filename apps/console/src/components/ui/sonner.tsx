import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
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
 * (`--popover`, `--border`) every other surface uses, so it flips with
 * `data-theme` rather than needing a light and a dark variant.
 */
function Toaster({ ...props }: ToasterProps) {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
