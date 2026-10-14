import { Link } from "@tanstack/react-router";
import { ChevronRight, Sun } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountTeam } from "@/lib/account";
import { useOwnDisplayNameProperty } from "@/lib/display-name";
import { type ThemePreference, useTheme } from "@/theme";

/** Route prefix that puts the shell into its Settings view. */
export const SETTINGS_PATH = "/settings";

/** The signed-in identity as the shell renders it (user-ref vocabulary). */
export interface ShellUser {
  display?: string;
  identifier?: string;
  userId?: string;
}

/**
 * The design's `Gradient/Red`, a placeholder portrait: no avatar image source
 * exists on the session yet. 24px in the footer row.
 */
const AVATAR = "size-6 shrink-0 rounded-full bg-(image:--zl-gradient-red)";

/**
 * The account rows sit flush, 32px tall with the design's 32px right inset;
 * the separators sit flush against them, so the default `-mx-1 my-1` comes off.
 */
const MENU_ITEM = "h-8 pr-8";
const MENU_SEPARATOR = "mx-0 my-0";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * One segment of the theme control: a compact menu item, filled when chosen.
 * Tinted with `foreground` rather than `muted`/`accent`, which on the dark
 * theme are the popover's own colour and would leave the choice invisible.
 */
const THEME_SEGMENT =
  "h-6 rounded-sm px-2 text-xs text-muted-foreground data-[highlighted]:bg-foreground/5 aria-checked:bg-foreground/10 aria-checked:text-foreground";

/**
 * Theme, as a segmented control on one row — System, Light, Dark. It lives
 * here rather than in the top bar so the bar holds context and search only,
 * and so the Settings view, which has no top bar, can change it too.
 *
 * The segments are menu items (`menuitemradio`), not loose buttons: a menu
 * moves focus with the arrow keys and swallows Tab, so only items are
 * reachable from the keyboard. Choosing one keeps the menu open, so the
 * change can be seen and undone in place.
 */
function ThemeRow() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="flex h-10 items-center justify-between gap-2 px-2">
      <span className="flex items-center gap-2 text-sm">
        <Sun className="size-4 text-muted-foreground" aria-hidden />
        Theme
      </span>
      <DropdownMenuGroup
        aria-label="Theme"
        className="flex rounded-md border border-foreground/10 p-0.5"
      >
        {THEMES.map((theme) => (
          <DropdownMenuItem
            key={theme.value}
            role="menuitemradio"
            aria-checked={preference === theme.value}
            className={THEME_SEGMENT}
            onSelect={(event) => {
              event.preventDefault();
              setPreference(theme.value);
            }}
          >
            {theme.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </div>
  );
}

/**
 * Footer account entry: the signed-in person over the account they work in,
 * opening the account dropdown to the right of the sidebar (Console ADR 0003).
 *
 * The person is the session's user-ref (display → identifier → user id, ADR
 * 058). The account is their team in the sign-in project (`lib/account.ts`),
 * renamed under Settings → Account. It shows the current account only — there
 * is nothing to switch to while a person's account is the one team.
 *
 * The design draws a plan badge (`Pro`) beside the account; it is left out
 * until billing (#667) can say which plan an account is on. `Documentation` and
 * `Feedback` are parked for the same reason the sidebar's Documentation row is:
 * neither has a destination yet, and a row that does nothing reads as broken.
 */
export function UserMenuItem({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const primary = user?.identifier ?? user?.display ?? user?.userId ?? "Signed in";
  const name = user?.display ?? primary;
  const account = useAccountTeam(user?.userId);
  // Asked only while there is no name: once `display` is set there is nothing
  // to prompt for.
  const nameProperty = useOwnDisplayNameProperty(!user?.display);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip={primary}
            aria-label={`Account: ${primary}`}
            className="h-auto min-h-12 py-2"
          >
            <span aria-hidden className={AVATAR} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm leading-none font-semibold">{primary}</span>
              {account === undefined ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                account && (
                  <span className="truncate text-xs font-light text-muted-foreground">
                    {account.name}
                  </span>
                )
              )}
            </span>
            <ChevronRight className="ml-auto text-sidebar-foreground" aria-hidden />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={8}
          className="w-64 border-foreground/10 p-0"
        >
          {!user?.display && nameProperty ? (
            // No name yet, and the schema has room for one: the header is the
            // way to add it, where the name would otherwise be.
            <DropdownMenuItem asChild className="flex-col items-start gap-0.5 py-2 pr-8">
              <Link to="/settings/profile" hash={nameProperty}>
                <span className="truncate text-sm text-muted-foreground italic">Add your name</span>
                <span className="truncate text-xs leading-none text-muted-foreground">
                  {primary}
                </span>
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuLabel className="flex flex-col gap-0.5 py-2 pr-8 font-normal">
              <span className="truncate text-sm">{name}</span>
              {name !== primary && (
                <span className="truncate text-xs leading-none text-muted-foreground">
                  {primary}
                </span>
              )}
            </DropdownMenuLabel>
          )}
          <DropdownMenuSeparator className={MENU_SEPARATOR} />
          {account && (
            <DropdownMenuItem asChild className={MENU_ITEM}>
              <Link to="/settings/account">
                <span className="truncate">{account.name}</span>
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild className={MENU_ITEM}>
            <Link to="/settings/profile">Profile</Link>
          </DropdownMenuItem>
          <ThemeRow />
          <DropdownMenuSeparator className={MENU_SEPARATOR} />
          <div className="p-1">
            <DropdownMenuItem onSelect={() => onSignOut?.()} disabled={!onSignOut} className="h-8">
              {/* The design spells it `Logout`, the noun; the action is the verb. */}
              Log out
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
