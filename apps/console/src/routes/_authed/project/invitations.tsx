import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { MailPlus } from "lucide-react";

import { DETAIL_STACK } from "@/components/detail-page";
import { SECTION_HEADING } from "@/components/typography";
import {
  type InvitationsRead,
  InviteMemberButton,
  ProjectInvitations,
  readInvitations,
} from "@/features/invitations/components/project-invitations";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/features/projects/project-scope";
import { describeError } from "@/lib/api-error";

/**
 * Project Settings → Invitations (root ADR 086 §6, #2855): the links made to
 * bring colleagues into the project, in a table apart from the people who are
 * in it (Admins), with Invite member on the heading's row. The header is the
 * Settings layout's (`route.tsx`), which also reads the project this page
 * names in the message an administrator copies.
 *
 * A failed read is shown in place of the table rather than thrown: the layout
 * and its header stay, and the API's own message says why.
 */
export const Route = createFileRoute("/_authed/project/invitations")({
  staticData: {
    scope: "project",
    nav: { label: "Invitations", view: "project-settings", order: 3, icon: MailPlus },
  },
  loaderDeps: projectScopeDeps,
  loader: ({ deps }): Promise<InvitationsRead> =>
    readInvitations(requireProjectScope(deps.project)).catch(
      (cause): InvitationsRead => ({
        error: describeError(cause, "The invitations could not be read."),
      }),
    ),
  component: ProjectInvitationsPage,
});

const settings = getRouteApi("/_authed/project");

function ProjectInvitationsPage() {
  const projectId = useRequiredProjectScope();
  const { project } = settings.useLoaderData();
  const read = Route.useLoaderData();
  const router = useRouter();
  const reload = () => void router.invalidate();

  return (
    <div className={DETAIL_STACK}>
      <div className="flex items-center justify-between gap-6">
        <h2 className={SECTION_HEADING}>Invitations</h2>
        <InviteMemberButton projectId={projectId} projectName={project.name} onInvited={reload} />
      </div>
      <ProjectInvitations
        projectId={projectId}
        projectName={project.name}
        read={read}
        onChanged={reload}
      />
    </div>
  );
}
