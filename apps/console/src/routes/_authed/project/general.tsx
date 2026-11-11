import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";

import { api } from "@/api/zitadel";
import { RenameCard } from "@/components/rename-card";
import { readDeployedPasswordPolicy } from "@/features/project-settings/api";
import { ProjectOrigins } from "@/features/project-settings/components/project-origins";
import {
  type PasswordPolicyRead,
  ProjectPolicies,
} from "@/features/project-settings/components/project-policies";
import { ProjectVariables } from "@/features/project-settings/components/project-variables";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { describeError } from "@/lib/api-error";

/**
 * Project Settings → General (Vercel's name for it; Overview is the project's
 * landing, D35): the project's name, its origins, its variables and secrets
 * and its policies. The project and its origins come from the Settings layout
 * (`route.tsx`), which draws the header; this page reads the rest.
 */
export const Route = createFileRoute("/_authed/project/general")({
  staticData: {
    scope: "project",
    nav: { label: "General", view: "project-settings", order: 1, icon: SlidersHorizontal },
  },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [variables, passwordPolicy] = await Promise.all([
      // No kind: every name with its value per kind, which is what the table
      // shows side by side.
      api.listVariables({ project_id: projectId }),
      // The password policy the primary origins enforce, which is the one
      // their release pins rather than the newest published revision.
      // Read-only, so a failed read costs the card its row, not the page its
      // editable sections.
      readDeployedPasswordPolicy(projectId).then(
        (read): PasswordPolicyRead => read ?? { deployed: false },
        (cause): PasswordPolicyRead => ({
          error: describeError(cause, "The password policy could not be read."),
        }),
      ),
    ]);
    return { variables, passwordPolicy };
  },
  component: ProjectGeneral,
});

function ProjectGeneral() {
  const { project } = useLoaderData({ from: "/_authed/project" });
  const { variables, passwordPolicy } = Route.useLoaderData();
  const router = useRouter();
  const reload = () => void router.invalidate();

  return (
    // The page owns the 16px between its cards.
    <div className="flex flex-col gap-4">
      <RenameCard
        id="project-name"
        layout="inline"
        label="Project name"
        value={project.name}
        onSave={async (name) => {
          await api.updateProject(project.id, { name });
          await router.invalidate();
        }}
        errorFallback="Could not save the project."
      />
      <ProjectOrigins projectId={project.id} origins={project.origins} onChanged={reload} />
      <ProjectVariables variables={variables} />
      <ProjectPolicies password={passwordPolicy} />
    </div>
  );
}
