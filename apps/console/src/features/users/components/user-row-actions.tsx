import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { DeleteUserDialog } from "@/features/users/components/delete-user-dialog";
import { RowMenu } from "@/components/resource-list";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { UserLinks } from "@/features/users/links";

/**
 * The row menu carries only actions that reach the API.
 *
 * The design's fuller menu is not buildable yet:
 *
 *   - `Edit user` — no `PATCH`/`PUT /users/{user_id}` endpoint (#693)
 *   - `Deactivate` — no `status` field and no lifecycle endpoint (#553)
 *   - `Reset password` — `PUT /users/{user_id}/password` exists, but the screen
 *     that would collect the new password does not
 *
 * They are left out rather than disabled so the menu is a list of things that
 * work. Add each one back with the change that makes it real.
 */
export function UserRowActions({
  userId,
  name,
  detail,
  onDeleted,
}: {
  userId: string;
  name: string;
  /** The user's detail, which View details opens. */
  detail: UserLinks["detail"];
  onDeleted: () => void | Promise<void>;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <RowMenu name={name}>
        <DropdownMenuItem asChild>
          <Link to={detail} params={{ userId }}>
            View details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
          Delete
        </DropdownMenuItem>
      </RowMenu>
      {/* Outside the menu, and opened by state rather than a trigger, so the
          menu closes on select. Nested inside, the still-open menu keeps the
          rest of the page `aria-hidden` after the dialog is dismissed. */}
      <DeleteUserDialog
        userId={userId}
        name={name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onDeleted}
      />
    </>
  );
}
