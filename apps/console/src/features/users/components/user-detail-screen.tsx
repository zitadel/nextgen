import { useRouter } from "@tanstack/react-router";
import { User } from "lucide-react";
import { useState } from "react";
import { DeleteUserDialog } from "@/features/users/components/delete-user-dialog";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DETAIL_CARD, DetailHeader, DetailSection } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/date";
import { UserAuthentication } from "@/features/users/components/user-authentication";
import type { UserLinks } from "@/features/users/links";
import type { LoadedUser } from "@/features/users/load";
import { field } from "@/lib/record";
import {
  hasNoSignInMethod,
  userAttributes,
  userIdentity,
  userIdentitySecondary,
  userMetadata,
} from "@/features/users/model";
import { UserProfileCard } from "@/features/users/components/user-profile-card";

/**
 * User detail — the overview and authentication tabs. Drawn for a user of the
 * selected project, and at the root for one of the reserved platform
 * project's People (D41), whose schema reads as text and whose deletion
 * returns to People (`links`).
 *
 * Some of the design cannot be built yet, and what is missing is *data*, not
 * markup. Rather than render labels with nothing behind them, each is left out
 * and recorded here:
 *
 *   - **Last login** in the header card: no such field anywhere on the user
 *   - **unlinking** a provider account: links are written only by a sign-in
 *
 * The design's "Project permissions" block is not pending — it has been removed
 * from the design (decisions log D6, and the log's open question on how project,
 * team and access relate).
 */
export function UserDetailScreen({
  userId,
  detail,
  links,
}: {
  userId: string;
  /** The route's load (`fetchUserDetail`). */
  detail: LoadedUser;
  /** Where the screen's links lead (`PROJECT_USER_LINKS`, `PEOPLE_USER_LINKS`). */
  links: UserLinks;
}) {
  const {
    user,
    schema,
    ownRevisionId,
    latestSchemaId,
    revisions,
    passkeys,
    identityLinks,
    idps,
    passwordSetAt,
  } = detail;
  const router = useRouter();
  const attributes = userAttributes(user);
  // The server-resolved identity chain (ADR 058): display → identifier → id.
  const name = userIdentity(user) ?? userId;
  const secondary = userIdentitySecondary(user);
  const metadata = userMetadata(user);
  const [tab, setTab] = useState("overview");

  return (
    <Page>
      {/* `User`, the sidebar's glyph for Users, as each detail title carries its
          section's. */}
      <DetailHeader
        icon={User}
        title={name}
        status={metadata.status && <StatusBadge status={metadata.status} />}
        subtitle={secondary}
        meta={
          <>
            <MetaValue label="User ID" value={userId} copyable />
            {metadata.createdAt && (
              <>
                <MetaRule />
                <MetaValue label="Created" value={formatDate(metadata.createdAt)} />
              </>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className={`${DETAIL_BODY} gap-6`}>
        <TabsList aria-label="User detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="authentication">Authentication</TabsTrigger>
        </TabsList>

        {/* Kept mounted, and hidden while another tab is open, so the profile
            draft survives a look at Authentication. */}
        <TabsContent
          value="overview"
          forceMount
          hidden={tab !== "overview"}
          className="flex flex-col gap-6"
        >
          <UserProfileCard
            // The route reuses this for the next user: a save's error stays with its own.
            key={userId}
            userId={userId}
            schema={schema}
            schemaId={field(user, "schema")}
            ownRevisionId={ownRevisionId}
            latestSchemaId={latestSchemaId}
            revisions={revisions}
            attributes={attributes}
            links={links}
            onSaved={() => router.invalidate()}
          />

          <Card className={DETAIL_CARD}>
            <CardContent className="flex flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-4">
                <span className="text-foreground font-serif text-base leading-none">
                  Delete user
                </span>
                <span className="text-muted-foreground text-[13px] leading-[19px]">
                  Permanently removes {name}, including sessions and access grants. This can&rsquo;t
                  be undone.
                </span>
              </div>
              <DeleteUserDialog
                userId={userId}
                name={name}
                onDeleted={() => router.navigate({ to: links.list })}
              >
                {/* `lg` for the design's 40px height; the padding stays at 10px
                    rather than `lg`'s 24px, which is what makes it 93px wide. */}
                <Button variant="destructive" size="lg" className="shrink-0 px-2.5">
                  Delete user
                </Button>
              </DeleteUserDialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="authentication">
          <DetailSection
            title="Authentication"
            description={
              hasNoSignInMethod({ passwordSetAt, passkeys, identityLinks }) &&
              "This user cannot sign in because no sign-in method is configured."
            }
          >
            <UserAuthentication
              passwordSetAt={passwordSetAt}
              passkeys={passkeys}
              identityLinks={identityLinks}
              idps={idps}
              idpDetail={links.idp}
            />
          </DetailSection>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
