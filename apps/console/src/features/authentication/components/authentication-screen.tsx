import { useEffect } from "react";

import { Page } from "@/components/layout";
import { ResourceTitle } from "@/components/resource-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  IdentityProviders,
  type IdpDetailRoute,
  SignInMethods,
} from "@/features/authentication/components/authentication-tables";
import type { AuthenticationData } from "@/features/authentication/load";
import type { AuthenticationSearch } from "@/features/authentication/model";

type Tab = AuthenticationSearch["tab"];

/**
 * Authentication: the sign-in methods in use across a project's user schemas,
 * and its identity provider connections. Drawn for the selected project, and
 * at the root for the reserved platform project (D41), where it is how people
 * sign in to the console. Read-only: sign-in methods live in the schema
 * document and connections are applied through the CLI (#998).
 *
 * The route owns the open tab (`?tab=`, `onTabChange`) and the page a
 * connection opens (`detail`), so the screen never asks where it is drawn.
 */
export function AuthenticationScreen({
  loaded,
  tab: requested,
  onTabChange,
  detail,
}: {
  loaded: AuthenticationData;
  tab: Tab;
  /** Puts `tab` in the URL; `replace` for a correction rather than a choice. */
  onTabChange: (tab: Tab, replace?: boolean) => void;
  detail: IdpDetailRoute;
}) {
  // Without `idp.read` the tab does not exist, so a link to it opens Sign-in
  // methods rather than an empty strip, and the URL drops the tab it cannot
  // show.
  const canReadIdps = loaded.idps !== null;
  const staleTab = !canReadIdps && requested !== undefined;
  useEffect(() => {
    if (staleTab) onTabChange(undefined, true);
  }, [staleTab, onTabChange]);
  const tab = canReadIdps && requested === "identity-providers" ? requested : "sign-in";

  return (
    <Page>
      <ResourceTitle>Authentication</ResourceTitle>

      {/* 8px under the title and 16px over the table, as the page header
          draws the tab strip. */}
      <Tabs
        value={tab}
        onValueChange={(next) =>
          onTabChange(next === "identity-providers" ? "identity-providers" : undefined)
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
          <SignInMethods loaded={loaded} detail={detail} />
        </TabsContent>

        {loaded.idps && (
          <TabsContent value="identity-providers">
            <IdentityProviders idps={loaded.idps} schemas={loaded.schemas} detail={detail} />
          </TabsContent>
        )}
      </Tabs>
    </Page>
  );
}
