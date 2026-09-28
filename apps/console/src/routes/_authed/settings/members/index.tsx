import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { Ellipsis, Plus, User } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FigmaIcons } from "@/components/figma-icons";
import { RESOURCE_CELL, RESOURCE_TABLE_WRAP, ResourceHeadCell } from "@/components/resource-list";
import { SettingsPage } from "@/components/settings-page";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  FIXTURE_TEAM_NAME,
  SETTINGS_MEMBERS,
  type SettingsMember,
} from "../../../../lib/settings-members.fixture";

/**
 * Settings › Members — the Figma `Admins` frame (2097:7271) and its states: the
 * pending-invite menu (2097:7294), the Invite dialog (1574:24765), the Revoke /
 * Remove confirmations (1858:30642, 1705:11212) and their toasts.
 *
 * **Design ahead of the API** — see `settings-members.fixture.ts`. The screen
 * renders a static member list and keeps its changes in component state.
 *
 * MVP scope: one role, project admin. The frame's Level column and its
 * Make owner / last-owner states are dropped; pending invites gain Resend.
 *
 * Table: Email (muted) · Status · actions on the resource table (8px card,
 * 56px rows, 16px cells) in the 704px Settings column.
 */
export const Route = createFileRoute("/_authed/settings/members/")({
  staticData: {
    nav: { label: "Members", view: "settings", group: "WORKSPACE", order: 1, icon: User },
  },
  component: MembersScreen,
});

function MembersScreen() {
  const [members, setMembers] = useState<SettingsMember[]>(SETTINGS_MEMBERS);

  const remove = (memberId: string) =>
    setMembers((current) => current.filter((member) => member.id !== memberId));

  /** Returns an error message, or `undefined` when the invite was added. */
  const invite = (email: string): string | undefined => {
    if (members.some((member) => member.email.toLowerCase() === email.toLowerCase())) {
      return `${email} is already a member of this team.`;
    }
    setMembers((current) => [
      ...current,
      { id: `member_${Date.now().toString(36)}`, email, status: "pending" },
    ]);
    return undefined;
  };

  return (
    // The Figma Lucide stroke, as on the shell and the Login flows table.
    <FigmaIcons>
      <SettingsPage title="Members" action={<InviteDialog onInvite={invite} />}>
        <div className={RESOURCE_TABLE_WRAP}>
          <Table className="table-fixed text-xs">
            <TableHeader>
              <TableRow className="border-border border-b hover:bg-transparent">
                <ResourceHeadCell className="text-muted-foreground">Email</ResourceHeadCell>
                <ResourceHeadCell className="w-[168px]">Status</ResourceHeadCell>
                <TableHead className="h-14 w-[168px] px-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow className="border-0 hover:bg-transparent">
                  <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((member) => (
                  <TableRow key={member.id} className="hover:bg-muted/40 border-0">
                    <TableCell
                      className={`${RESOURCE_CELL} truncate text-sm text-muted-foreground`}
                    >
                      {member.email}
                    </TableCell>
                    <TableCell className={RESOURCE_CELL}>
                      {/* Active carries the success dot; Pending is a plain pill. */}
                      {member.status === "active" ? (
                        <StatusBadge status="active" />
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className={`${RESOURCE_CELL} text-right`}>
                      <RowActions member={member} onRemove={() => remove(member.id)} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </SettingsPage>
    </FigmaIcons>
  );
}

/**
 * The row menu. One role, so there is no level to change:
 *   - active member  → `Remove` (confirmed with the Figma `Remove admin?` dialog)
 *   - pending invite → `Resend invite` · `Revoke invite` (confirmed)
 */
function RowActions({ member, onRemove }: { member: SettingsMember; onRemove: () => void }) {
  const { session } = useRouteContext({ from: "/_authed" });
  const [confirm, setConfirm] = useState<"revoke" | "remove" | undefined>(undefined);
  const label = member.name ?? member.email;
  const isSelf =
    member.email.toLowerCase() === (session.user?.identifier ?? "").trim().toLowerCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${label}`}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {member.status === "pending" ? (
            <>
              <DropdownMenuItem
                onSelect={() =>
                  toast.info("Invite sent again", {
                    description: `${member.email} has received a new signup link.`,
                  })
                }
              >
                Resend invite
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("revoke")}>
                Revoke invite
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("remove")}>
              Remove
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(open) => !open && setConfirm(undefined)}
        title="Revoke invite?"
        description="Their signup link stops working. You can invite them again at any time."
        action="Revoke invite"
        onConfirm={() => {
          onRemove();
          toast.info("Invite revoked", {
            description: `${member.email} can't use their signup link anymore.`,
          });
        }}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => !open && setConfirm(undefined)}
        title="Remove admin?"
        description="They immediately lose access to this team's projects. Their user account isn't deleted, and their other team memberships aren't affected."
        action="Remove admin"
        onConfirm={() => {
          onRemove();
          // Removing yourself is leaving the team — its own toast in the frames.
          if (isSelf) {
            toast.info(`You left ${FIXTURE_TEAM_NAME}`, {
              description: "You no longer have access to this team's projects.",
            });
          } else {
            toast.info(`${label} removed`, {
              description: "They no longer have access to this team's projects.",
            });
          }
        }}
      />
    </>
  );
}

/**
 * `Invite admin` (Figma 1574:24765): 384px, `rounded-xl`; serif title, muted
 * description, one Email field; Cancel (outline) and Add (primary).
 */
function InviteDialog({ onInvite }: { onInvite: (email: string) => string | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shrink-0 gap-1.5 px-2.5!">
          <Plus aria-hidden />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-6 rounded-xl border-foreground/10 sm:max-w-sm!">
        <DialogHeader className="gap-2">
          <DialogTitle className="font-serif text-lg leading-5 font-normal">
            Invite admin
          </DialogTitle>
          <DialogDescription className="leading-5">
            They’ll be added to your project as an admin.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per opening so a cancelled draft leaves nothing behind. */}
        {open && <InviteForm onInvite={onInvite} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  onInvite,
  onDone,
}: {
  onInvite: (email: string) => string | undefined;
  onDone: () => void;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = value.trim();
    const failure = onInvite(email);
    if (failure) {
      setError(failure);
      return;
    }
    toast.info("Invite sent", {
      description: `${email} has been notified by email to join this team as admin.`,
    });
    onDone();
  }

  return (
    <form className="contents" onSubmit={submit}>
      <Field data-invalid={error ? true : undefined} className="gap-3">
        <FieldLabel htmlFor={inputId} className="font-serif font-normal">
          Email
        </FieldLabel>
        <Input
          id={inputId}
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="colleague@company.com"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
        />
        <FieldError id={errorId}>{error}</FieldError>
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" className="px-2.5" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" className="px-2.5" disabled={value.trim() === ""}>
          Add
        </Button>
      </DialogFooter>
    </form>
  );
}
