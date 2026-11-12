import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { useEffect } from "react";
import { ResourceTitle } from "@/components/resource-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchAllIdps } from "@/features/authentication/api";
import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { fetchAllSchemas } from "@/features/schemas/api";
import { Page } from "@/components/layout";
import {
  IdentityProviders,
  type Loaded,
  SignInMethods,
} from "@/features/authentication/components/authentication-tables";

/**
 * Authentication — the sign-in methods in use across the project's user
 * schemas, and its identity provider connections. Read-only: sign-in methods
 * live in the schema document and connections are applied through the CLI
 * (#998).
 *
 * The open tab is in the URL (`?tab=`), so a reload or a shared link opens
 * the same one.
 */
export interface AuthenticationSearch {
  /** `identity-providers`, or absent for the default Sign-in methods tab. */
  tab?: "identity-providers";
}

export const Route = createFileRoute("/_authed/authentication/")({
  // After Deployments, as the design's single-level sidebar places it.
  staticData: { scope: "project", nav: { label: "Authentication", order: 8, icon: Shield } },
  validateSearch: (search: Record<string, unknown>): AuthenticationSearch =>
    search.tab === "identity-providers" ? { tab: "identity-providers" } : {},
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }): Promise<Loaded> => {
    const projectId = requireProjectScope(deps.project);
    // The whole project's schemas and connections: both tabs join the two on
    // the slug, and no API answers that join directly. The connections are
    // also the Identity providers list, so it is not paged.
    const [schemas, idps] = await Promise.all([
      fetchAllSchemas(projectId),
      fetchAllIdps(projectId),
    ]);
    return { schemas, idps };
  },
  component: AuthenticationScreen,
});

function AuthenticationScreen() {
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Without `idp.read` the tab does not exist, so a link to it opens Sign-in
  // methods rather than an empty strip, and the URL drops the tab it cannot
  // show.
  const canReadIdps = loaded.idps !== null;
  const staleTab = !canReadIdps && search.tab !== undefined;
  useEffect(() => {
    if (staleTab) void navigate({ search: {}, replace: true });
  }, [staleTab, navigate]);
  const tab = canReadIdps && search.tab === "identity-providers" ? search.tab : "sign-in";

  return (
    <Page>
      <ResourceTitle>Authentication</ResourceTitle>

      {/* 8px under the title and 16px over the table, as the page header
          draws the tab strip. */}
      <Tabs
        value={tab}
        onValueChange={(next) =>
          void navigate({
            search: { tab: next === "identity-providers" ? "identity-providers" : undefined },
          })
        }
        className="mt-2 gap-4"
      >
        <TabsList className="h-10 px-0 py-[3px]">
          <TabsTrigger value="sign-in" variant="muted">
            Sign-in methods
          </TabsTrigger>
          {canReadIdps && (
            <TabsTrigger value="identity-providers" variant="muted">
              Identity providers
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sign-in">
          <SignInMethods loaded={loaded} />
        </TabsContent>

        {loaded.idps && (
          <TabsContent value="identity-providers">
            <IdentityProviders idps={loaded.idps} schemas={loaded.schemas} />
          </TabsContent>
        )}
      </Tabs>
    </Page>
  );
}
