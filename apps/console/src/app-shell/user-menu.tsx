import { Link } from "@tanstack/react-router";
import { ChevronRight, ExternalLink, type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { UserAvatar, avatarSeed, avatarVars } from "@/components/user-avatar";
import { DOCS_URL } from "@/lib/docs";
import { type ThemePreference, useTheme } from "@/theme";

/** Route prefix of Settings, whose pages the sidebar lists in place of the account's. */
export const SETTINGS_PATH = "/settings";

/** The signed-in identity as the shell renders it (user-ref vocabulary). */
export interface ShellUser {
  display?: string;
  identifier?: string;
  userId?: string;
}

/** The separators sit flush against the rows, so the default `-mx-1 my-1` comes off. */
const MENU_SEPARATOR = "mx-0 my-0";

/** The footer's second line: the email under a name. */
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
  "size-6 justify-center rounded-sm p-0 text-muted-foreground data-[highlighted]:bg-foreground/5 data-[state=checked]:bg-foreground/10 data-[state=checked]:text-foreground";

/**
 * Theme, as a segmented control on one row — System, Light, Dark, drawn as icons. It lives
 * here rather than in the top bar so the bar holds context and search only.
 *
 * The segments are the menu's radio items (`DropdownMenuRadioGroup`, so
 * Radix owns `menuitemradio` and its checked state), not loose buttons: a menu
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
      <DropdownMenuRadioGroup
        aria-label="Theme"
        value={preference}
        onValueChange={(value) => setPreference(value as ThemePreference)}
        className="flex gap-0.5 rounded-md border border-foreground/10 p-0.5"
      >
        {THEMES.map((theme) => (
          <DropdownMenuRadioItem
            key={theme.value}
            value={theme.value}
            indicator={false}
            aria-label={theme.label}
            title={theme.label}
            className={THEME_SEGMENT}
            // Choosing keeps the menu open, so the change can be seen and undone.
            onSelect={(event) => event.preventDefault()}
          >
            <theme.icon aria-hidden />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </div>
  );
}

/** The person as the account menu names them, in ADR 058's order. */
function accountName(user?: ShellUser) {
  // The name leads once set, with the email beneath it; until then the email
  // stands alone. A blank name counts as none.
  const display = user?.display?.trim() || undefined;
  const email = user?.identifier;
  return {
    name: display ?? email ?? user?.userId ?? "Signed in",
    second: display && email,
  };
}

/**
 * The avatar an account trigger carries, and the trigger's props: the avatar's
 * colours sweep across the trigger on hover (`.avatar-host`, `styles.css`), and
 * its gradient moves faster while the trigger is hovered or its menu is open.
 */
function useAvatarHost(user?: ShellUser) {
  const seed = avatarSeed(user);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  return {
    image: <UserAvatar seed={seed} fast={hovered || open} />,
    host: {
      style: avatarVars(seed),
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    },
    onOpenChange: setOpen,
  };
}

/**
 * Footer account entry: the signed-in person, opening the account dropdown to
 * the right of the sidebar (Console ADR 0003). Accounts are not shown while
 * the cloud does not use them (Console ADR 0005 §3).
 */
export function UserMenuItem({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const { name, second } = accountName(user);
  const avatar = useAvatarHost(user);

  return (
    <SidebarMenuItem>
      <DropdownMenu onOpenChange={avatar.onOpenChange}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip={name}
            aria-label={`Account: ${name}`}
            // The avatar holds still while the sidebar collapses: it sits 16px
            // from the sidebar's edge in both states (the row's 8px inset here,
            // centred in the rail's 36px square there), so the label going
            // first moves nothing. The row is a fixed 48px, not a minimum, so
            // its height animates to the rail's 36px; the 8px lift animates
            // with it (`margin`), so the avatar keeps its height throughout.
            className="avatar-host h-12 py-1.5 pl-2 transition-[width,height,padding,margin] group-data-[collapsible=icon]:mb-2 group-data-[collapsible=icon]:p-1.5!"
            {...avatar.host}
          >
            {/* 24px in the footer row, generated from the identifier. */}
            {avatar.image}
            {/* Hidden on the rail, so the avatar alone is what centres. */}
            <span className="flex min-w-0 flex-1 flex-col gap-1 group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm leading-none font-semibold">{name}</span>
              {second && <span className={FOOTER_SECOND_LINE}>{second}</span>}
            </span>
            <ChevronRight
              className="ml-auto text-sidebar-foreground group-data-[collapsible=icon]:hidden"
              aria-hidden
            />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <AccountMenuContent user={user} onSignOut={onSignOut} />
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

/**
 * The account dropdown, opening to the right of the sidebar's footer row. On
 * a phone the sidebar is a sheet with no room beside it, so the menu opens
 * above the row instead, which sits at the bottom of the sheet.
 *
 * It follows Vercel's: the person heads it and opens their profile
 * (`/account`, apart from the root Settings, D41); then Theme, Documentation
 * and Log out. Nothing else repeats a Settings page. `Feedback` is parked: it has no
 * destination yet, and a row that does nothing reads as broken.
 */
function AccountMenuContent({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const { name, second } = accountName(user);
  const { isMobile } = useSidebar();

  return (
    <DropdownMenuContent
      side={isMobile ? "top" : "right"}
      align="end"
      sideOffset={8}
      className="w-64 border-foreground/10 p-0"
    >
      <DropdownMenuGroup className="p-1">
        <DropdownMenuItem asChild className="flex-col items-start gap-1 py-2">
          <Link to="/account">
            <span className="max-w-full truncate text-sm font-medium">{name}</span>
            {second && (
              <span className="max-w-full truncate text-xs leading-none text-muted-foreground">
                {second}
              </span>
            )}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator className={MENU_SEPARATOR} />
      <ThemeRow />
      <DropdownMenuSeparator className={MENU_SEPARATOR} />
      <DropdownMenuGroup className="p-1">
        <DropdownMenuItem asChild className="h-8">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Documentation
            <ExternalLink className="ml-auto" strokeWidth={1.5} aria-hidden />
          </a>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator className={MENU_SEPARATOR} />
      <DropdownMenuGroup className="p-1">
        <DropdownMenuItem onSelect={() => onSignOut?.()} disabled={!onSignOut} className="h-8">
          {/* The design spells it `Logout`, the noun; the action is the verb. */}
          Log out
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}
