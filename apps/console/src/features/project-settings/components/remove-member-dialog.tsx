import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { MemberRow, RowAction } from "@/features/project-settings/members";
import { formatDate } from "@/lib/date";
import { joinAnd } from "@/lib/text";

/**
 * The confirmation behind a members row's menu: `Remove access` revokes every
 * grant the row holds, `Remove role` the grants of its weakest role, which its
 * strongest already includes.
 *
 * `DELETE /grants/{grant_id}` revokes one grant on the project the page names,
 * never the console's own (#1238), and touches nothing else the person holds.
 * The members list names a person for a team only where the team gives them
 * their strongest role, so the copy never claims a loss it cannot know: a
 * person may still hold the project through a team it does not list.
 */
export function RemoveMemberDialog({
  projectId,
  row,
  action,
  open,
  onOpenChange,
  onRemoved,
}: {
  projectId: string;
  row: MemberRow;
  action: RowAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const role = action.kind === "remove-role";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={role ? `Remove ${action.role} role?` : "Remove access?"}
      description={describe(row, action)}
      action={role ? "Remove role" : "Remove access"}
      fallback={
        role ? "Could not remove the role. Try again." : "Could not remove access. Try again."
      }
      onConfirm={async () => {
        const results = await Promise.allSettled(
          action.grantIds.map((grantId) => api.deleteGrant(grantId, { project_id: projectId })),
        );
        const failed = results.find((result) => result.status === "rejected");
        if (failed) {
          // A grant that went is gone whatever happened to the others, so the
          // table reloads to show what is left, and the dialog shows the error.
          if (results.some((result) => result.status === "fulfilled")) onRemoved();
          throw failed.reason;
        }
        toast.success(role ? "Role removed" : "Access removed");
        onRemoved();
      }}
    />
  );
}

function describe(row: MemberRow, action: RowAction): string {
  if (action.kind === "remove-role") {
    const until = action.keepsUntil ? ` until ${formatDate(action.keepsUntil)}` : "";
    return `${row.name} keeps ${action.keeps} access to this project${until}.`;
  }
  if (row.expiry.kind === "expired") {
    return `${row.name}'s access to this project has expired. This removes it from the list.`;
  }
  if (row.kind === "team") {
    const count = row.members.length;
    return count === 0
      ? `${row.name} will lose access to this project.`
      : `${row.name} will lose access to this project, and so will its ${count} ${count === 1 ? "member" : "members"} unless they hold it another way.`;
  }
  return row.teams.length > 0
    ? `${row.name} keeps access to this project through ${joinAnd(row.teams)}.`
    : `${row.name} will lose access to this project, unless they hold it through a team.`;
}
