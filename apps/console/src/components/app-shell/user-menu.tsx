import { Link } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/** Route prefix that puts the shell into its Settings view. */
export const SETTINGS_PATH = "/settings";

/** The signed-in identity as the shell renders it (user-ref vocabulary). */
export interface ShellUser {
  display?: string;
  identifier?: string;
  userId?: string;
}

/**
 * The identity block: 32px avatar, name, email. It is drawn twice — as the
 * footer trigger and again as the dropdown's header — so it lives in one place.
 *
 * The gradient is the design's `Gradient/Red`, a placeholder portrait: no
 * avatar image source exists on the session yet.
 */
function UserIdentity({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <>
      <span aria-hidden className="size-8 shrink-0 rounded-full bg-(image:--zl-gradient-red)" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
        <span className="truncate text-sm leading-none font-semibold">{primary}</span>
        {secondary && <span className="truncate text-xs leading-none">{secondary}</span>}
      </span>
    </>
  );
}

/**
 * Footer account entry: the signed-in identity from `GET /sessions/me`
 * (display → identifier → user id fallback, the user-ref rendering contract of
 * ADR 058), opening the account dropdown (Console ADR 0003).
 *
 * The dropdown is the entry point to the Settings view — `Settings` navigates
 * to the route that switches the sidebar over. Console-local chrome: the
 * console does not compose login-surface elements (ADR 055).
 *
 * Two details come from the design rather than from shadcn's defaults. The
 * container hairline resolves to `foreground/10`, not `border` — the two are
 * interchangeable on the light canvas and visibly are not on the dark one. And
 * the separators sit flush against the rows, so the default `-mx-1 my-1` comes
 * off.
 */
export function UserMenuItem({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const primary = user?.display ?? user?.identifier ?? user?.userId ?? "Signed in";
  // Show the identifier as the secondary line only when the display name is
  // the primary.
  const secondary = user?.display ? user.identifier : undefined;

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" tooltip={primary} aria-label={`Account: ${primary}`}>
            <UserIdentity primary={primary} secondary={secondary} />
            <ChevronsUpDown className="ml-auto text-muted-foreground" aria-hidden />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56 border-foreground/10">
          <DropdownMenuLabel className="flex h-11 items-center gap-2 font-normal">
            <UserIdentity primary={primary} secondary={secondary} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="mx-px my-0" />
          <DropdownMenuItem asChild>
            <Link to={SETTINGS_PATH}>Settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-px my-0" />
          <DropdownMenuItem onSelect={() => onSignOut?.()} disabled={!onSignOut}>
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
