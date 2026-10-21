import { Link } from "@tanstack/react-router";
import { ChevronRight, type LucideIcon, Monitor, Moon, Sun } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, avatarVars } from "@/components/user-avatar";
import { useSessionCached } from "@/hooks/use-async";
import { readAccountTeam } from "@/lib/account";
import { type ThemePreference, useTheme } from "@/theme";

/** Route prefix that puts the shell into its Settings view. */
export const SETTINGS_PATH = "/settings";

/** The signed-in identity as the shell renders it (user-ref vocabulary). */
export interface ShellUser {
  display?: string;
  identifier?: string;
  userId?: string;
}

/** The separators sit flush against the rows, so the default `-mx-1 my-1` comes off. */
const MENU_SEPARATOR = "mx-0 my-0";

/** The footer's second line: the email under a name, else the account. */
const FOOTER_SECOND_LINE = "truncate text-xs font-light text-muted-foreground";

const THEMES: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * One segment of the theme control: a compact icon-only menu item, filled when
 * chosen; the label names it for screen readers and on hover.
 * Tinted with `foreground` rather than `muted`/`accent`, which on the dark
 * theme are the popover's own colour and would leave the choice invisible.
 */
const THEME_SEGMENT =
  "size-6 justify-center rounded-sm p-0 text-muted-foreground data-[highlighted]:bg-foreground/5 aria-checked:bg-foreground/10 aria-checked:text-foreground";

/**
 * Theme, as a segmented control on one row — System, Light, Dark, drawn as icons. It lives
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
    // `px-3`: the clickable rows sit in a `p-1` box with their own `px-2`, so
    // the label lines up with theirs.
    <div className="flex h-10 items-center justify-between gap-2 px-3">
      <span className="text-sm">Theme</span>
      <DropdownMenuGroup
        aria-label="Theme"
        className="flex gap-0.5 rounded-md border border-foreground/10 p-0.5"
      >
        {THEMES.map((theme) => (
          <DropdownMenuItem
            key={theme.value}
            role="menuitemradio"
            aria-checked={preference === theme.value}
            aria-label={theme.label}
            title={theme.label}
            className={THEME_SEGMENT}
            onSelect={(event) => {
              event.preventDefault();
              setPreference(theme.value);
            }}
          >
            <theme.icon aria-hidden />
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
 * The person is named in ADR 058's order (display → identifier → user id):
 * once a name is set it leads, with the email beneath it; until then the
 * email leads, with the account beneath it — their team in the sign-in project
 * (`lib/account.ts`).
 *
 * The dropdown follows Vercel's: the person heads it and opens their profile
 * (Settings) in account settings, whose sidebar also lists Overview (their
 * teams, the account among them); then Theme and Log out.
 * Nothing else repeats a Settings page. `Documentation` and `Feedback` are
 * parked: neither has a destination yet, and a row that does nothing reads as
 * broken.
 */
export function UserMenuItem({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const email = user?.identifier ?? user?.userId ?? "Signed in";
  const name = user?.display ?? email;
  const account = useSessionCached(readAccountTeam, null);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip={name}
            aria-label={`Account: ${name}`}
            // The avatar's colours sweep across the row on hover (`styles.css`).
            // Collapsed to the rail, the row is the rail's 32px square with the
            // 24px avatar centred 4px in on every side; `min-h-12` would
            // otherwise stretch it into a 32x48 pill.
            className="avatar-host h-auto min-h-12 py-2 group-data-[collapsible=icon]:min-h-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1!"
            style={avatarVars(user?.userId ?? email)}
          >
            {/* 24px in the footer row, generated from the user id. */}
            <UserAvatar seed={user?.userId ?? email} />
            {/* Hidden on the rail, so the avatar alone is what centres. */}
            <span className="flex min-w-0 flex-1 flex-col gap-1 group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm leading-none font-semibold">{name}</span>
              {user?.display ? (
                <span className={FOOTER_SECOND_LINE}>{email}</span>
              ) : account === undefined ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                account && <span className={FOOTER_SECOND_LINE}>{account.name}</span>
              )}
            </span>
            <ChevronRight
              className="ml-auto text-sidebar-foreground group-data-[collapsible=icon]:hidden"
              aria-hidden
            />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={8}
          className="w-64 border-foreground/10 p-0"
        >
          <div className="p-1">
            <DropdownMenuItem asChild className="flex-col items-start gap-1 py-2">
              <Link to="/settings/profile">
                <span className="max-w-full truncate text-sm font-medium">{name}</span>
                {user?.display && (
                  <span className="max-w-full truncate text-xs leading-none text-muted-foreground">
                    {email}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          </div>
          <DropdownMenuSeparator className={MENU_SEPARATOR} />
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
