import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shield, Users, Workflow } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_FIXED,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourcePage,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { SignInStateBadge } from "@/components/sign-in-state-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { InlineCode } from "@/components/ui/inline-code";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";
import { type FlowDefinitionEntry, flowDisplayName } from "@/lib/flow-definition";
import {
  fetchAllFlows,
  fetchAllIdps,
  fetchAllSchemas,
  fetchIdpPage,
  flowsForSchema,
  type IdpConnection,
  idpProtocolLabel,
  schemaProviders,
} from "@/lib/idp";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/lib/project-scope";
import { schemaAuthMethods, schemaDisplayName, type UserSchema } from "@/lib/schema";
import { stringParam } from "@/lib/search-params";

/**
 * Authentication — how users of each schema sign in, and the project's identity
 * provider connections. Read-only: sign-in methods live in the schema document
 * and connections are applied through the CLI (#998).
 *
 * Both tabs are in the URL (`?tab=`, `?schema=`), so a reload or a shared link
 * opens the same view.
 */
export interface AuthenticationSearch {
  /** `identity-providers`, or absent for the default Sign-in tab. */
  tab?: "identity-providers";
  /** The schema whose sign-in methods are open on the Sign-in tab. */
  schema?: string;
}

export const Route = createFileRoute("/_authed/authentication/")({
  // Order 4: between Users (3) and Login flows (5), as the design places it.
  staticData: { scope: "project", nav: { label: "Authentication", order: 4, icon: Shield } },
  validateSearch: (search: Record<string, unknown>): AuthenticationSearch => {
    const schema = stringParam(search.schema);
    return {
      ...(search.tab === "identity-providers" ? { tab: "identity-providers" as const } : {}),
      ...(schema ? { schema } : {}),
    };
  },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }): Promise<Loaded> => {
    const projectId = requireProjectScope(deps.project);
    // The whole project's schemas, flows and connections: the Sign-in tab
    // resolves every slug and lists every flow pinning a schema, and no API
    // answers either directly.
    const [schemas, flows, idps] = await Promise.all([
      fetchAllSchemas(projectId),
      fetchAllFlows(projectId),
      fetchAllIdps(projectId),
    ]);
    // The list's own first page, newest first. Skipped without `idp.read`,
    // where the tab does not render and the request would only be refused.
    const page = idps ? await fetchIdpPage(projectId) : undefined;
    return {
      schemas,
      flows,
      idps,
      list: page ? { idps: page.idps, nextPageToken: page.nextPageToken } : undefined,
    };
  },
  component: AuthenticationScreen,
});

/** What the loader hands the tabs. Exported because the route tree names it. */
export interface Loaded {
  schemas: Array<{ id: string; schema: UserSchema; createdAt: string }>;
  flows: FlowDefinitionEntry[];
  /** `null` without `idp.read`. */
  idps: IdpConnection[] | null;
  /** The list tab's first page; absent without `idp.read`. */
  list?: { idps: IdpConnection[]; nextPageToken?: string };
}

function AuthenticationScreen() {
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Without `idp.read` the tab does not exist, so a link to it opens Sign-in
  // rather than an empty strip.
  const canReadIdps = loaded.list !== undefined;
  const tab = canReadIdps && search.tab === "identity-providers" ? search.tab : "sign-in";

  return (
    <ResourcePage>
      <ResourceTitle>Authentication</ResourceTitle>

      <Tabs
        value={tab}
        onValueChange={(next) =>
          void navigate({
            search: (prev) => ({
              ...prev,
              tab: next === "identity-providers" ? "identity-providers" : undefined,
              schema: undefined,
            }),
          })
        }
        className="mt-4 gap-4 lg:mt-5"
      >
        <TabsList className="h-10 px-0 py-[3px]">
          <TabsTrigger
            value="sign-in"
            variant="muted"
            // Radix does not report a click on the active trigger, and the
            // per-schema view sits under it: this is the way back to the list.
            onClick={() => {
              if (search.schema) {
                void navigate({ search: (prev) => ({ ...prev, schema: undefined }) });
              }
            }}
          >
            Sign-in
          </TabsTrigger>
          {canReadIdps && (
            <TabsTrigger value="identity-providers" variant="muted">
              Identity providers
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sign-in">
          {search.schema ? (
            <SchemaSignIn schemaId={search.schema} loaded={loaded} />
          ) : (
            <SignInOverview loaded={loaded} />
          )}
        </TabsContent>

        {loaded.list && (
          <TabsContent value="identity-providers">
            <IdentityProviders first={loaded.list} />
          </TabsContent>
        )}
      </Tabs>
    </ResourcePage>
  );
}

/**
 * One row per user schema, with a badge per enabled method — one per listed
 * provider in place of a single `SSO` — answering "how can users of this
 * schema sign in?" at a glance.
 */
function SignInOverview({ loaded }: { loaded: Loaded }) {
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className={RESOURCE_TABLE_WRAP}>
      <Table className={RESOURCE_TABLE_FIXED}>
        <TableHeader>
          <ResourceHeaderRow>
            <ResourceHeadCell className="w-1/3">User schema</ResourceHeadCell>
            <ResourceHeadCell>Sign-in methods</ResourceHeadCell>
          </ResourceHeaderRow>
        </TableHeader>
        <TableBody>
          {loaded.schemas.length === 0 ? (
            <ResourceEmptyRow colSpan={2}>This project has no user schemas.</ResourceEmptyRow>
          ) : (
            loaded.schemas.map(({ id, schema }) => {
              const name = schemaDisplayName(schema, id);
              return (
                <ResourceRow
                  key={id}
                  onOpen={() => void navigate({ search: (prev) => ({ ...prev, schema: id }) })}
                >
                  <TableCell className={`${RESOURCE_CELL} truncate`}>
                    <Link
                      from={Route.fullPath}
                      search={(prev) => ({ ...prev, schema: id })}
                      className={RESOURCE_ROW_LINK}
                    >
                      <Users aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
                      {name}
                    </Link>
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    <div className="flex flex-wrap gap-1.5">
                      {methodBadges(schema, loaded.idps).map((label) => (
                        <Badge key={label} variant="secondary">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </ResourceRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The enabled methods of a schema as badge labels: the plain methods first, in
 * `schemaAuthMethods`' stable order, then one per listed provider by its
 * connection's name — or its slug, without `idp.read` or without a connection.
 */
function methodBadges(schema: UserSchema, idps: IdpConnection[] | null): string[] {
  const methods = schemaAuthMethods(schema)
    .filter((method) => method.enabled && method.key !== "sso")
    .map((method) => method.label);
  const providers = schemaProviders(schema, idps)
    .filter((provider) => provider.state !== "disabled")
    .map((provider) => provider.name);
  return [...methods, ...providers];
}

/**
 * "Allowed sign-in methods" for one schema: Passkey and Password with their
 * state, one row per provider, and the login flows that pin the schema.
 */
function SchemaSignIn({ schemaId, loaded }: { schemaId: string; loaded: Loaded }) {
  const entry = loaded.schemas.find((candidate) => candidate.id === schemaId);
  if (!entry) {
    return (
      <Card className="items-center px-6 py-8 text-sm text-muted-foreground">
        This project has no user schema “{schemaId}”.
      </Card>
    );
  }

  const name = schemaDisplayName(entry.schema, entry.id);
  const declared = schemaAuthMethods(entry.schema);
  // Passkey and Password always have a row: "how can these users sign in" is
  // answered by what is off as much as by what is on. Any other method the
  // document declares follows (D10: a declared method is never hidden).
  const methods = [
    ...ALWAYS_SHOWN.map(
      (key) =>
        declared.find((method) => method.key === key) ?? {
          key,
          label: key === "passkey" ? "Passkey" : "Password",
          enabled: false,
        },
    ),
    ...declared.filter((method) => method.key !== "sso" && !ALWAYS_SHOWN.includes(method.key)),
  ];
  const providers = schemaProviders(entry.schema, loaded.idps);
  const flows = flowsForSchema(entry.id, loaded.flows);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-2 px-4 pt-3.5 pb-1.5">
        <h2 className="font-serif text-lg leading-6 text-foreground">{name}</h2>
        <h3 className="font-serif text-[15px] leading-[22px] text-foreground">
          Allowed sign-in methods
        </h3>
      </div>
      {methods.map((method, index) => (
        <Fragment key={method.key}>
          {index > 0 && <Separator className={RULE} />}
          <MethodRow label={method.label} state={method.enabled ? "enabled" : "disabled"} />
        </Fragment>
      ))}
      {providers.map((provider) => (
        <Fragment key={provider.slug}>
          <Separator className={RULE} />
          <MethodRow
            label={
              provider.idpId ? (
                <Link
                  to="/authentication/idps/$idpId"
                  params={{ idpId: provider.idpId }}
                  className="underline-offset-2 hover:underline"
                >
                  {provider.name}
                </Link>
              ) : (
                provider.name
              )
            }
            detail={provider.name === provider.slug ? undefined : provider.slug}
            state={provider.state}
          />
        </Fragment>
      ))}
      <Separator className={RULE} />
      <div className={ROW}>
        <span className={ROW_LABEL}>Login flows</span>
        <FlowLinks flows={flows} />
      </div>
    </Card>
  );
}

const ALWAYS_SHOWN = ["passkey", "password"];

/** A row: the method, a muted detail column, and its state at the end. */
const ROW = "flex items-center gap-4 px-4 py-3";
const ROW_LABEL = "w-40 shrink-0 text-sm font-medium text-foreground sm:w-[230px]";

/**
 * Hairlines between rows, inset to the card's 16px gutter. `w-auto!` because
 * `Separator`'s `data-[orientation=horizontal]:w-full` out-specifies a plain
 * width and would push the inset rule past the card's edge.
 */
const RULE = "mx-4 w-auto!";

function MethodRow({
  label,
  detail,
  state,
}: {
  label: ReactNode;
  detail?: string;
  state: "enabled" | "disabled" | "missing";
}) {
  return (
    <div className={ROW}>
      <span className={`${ROW_LABEL} truncate`}>{label}</span>
      {/* The slug repeats what the linked name opens, so a phone, which has
          no room for it beside the label, drops it rather than clip it. */}
      <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground sm:block">
        {detail}
      </span>
      <span aria-hidden className="flex-1 sm:hidden" />
      <SignInStateBadge state={state} />
    </div>
  );
}

function FlowLinks({ flows }: { flows: FlowDefinitionEntry[] }) {
  if (flows.length === 0) {
    return <span className="text-sm text-muted-foreground">No login flow uses this schema.</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
      {flows.map((entry) => (
        <Link
          key={entry.id}
          to="/flow-definitions/$definitionId"
          params={{ definitionId: entry.id }}
          className="inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-2 hover:underline"
        >
          <Workflow aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
          {flowDisplayName(entry.flow_definition)}
        </Link>
      ))}
    </span>
  );
}

/** The project's connections, newest first, paged with `Load more`. */
function IdentityProviders({
  first,
}: {
  first: { idps: IdpConnection[]; nextPageToken?: string };
}) {
  const projectId = useRequiredProjectScope();
  const paging = useLoadMore(
    first,
    async (pageToken) => {
      // `fetchIdpPage` sends the same `sorting` as the first page: a cursor
      // only pages the order that issued it.
      const page = await fetchIdpPage(projectId, pageToken);
      return { items: page.idps, nextPageToken: page.nextPageToken };
    },
    "Could not load more identity providers.",
  );
  const idps = [...first.idps, ...paging.extra];

  return (
    <>
      <div className={RESOURCE_TABLE_WRAP}>
        <Table className={`${RESOURCE_TABLE_FIXED} min-w-[44rem]`}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className="w-[26%]">Name</ResourceHeadCell>
              <ResourceHeadCell className="w-[18%]">Slug</ResourceHeadCell>
              <ResourceHeadCell className="w-[16%]">Template</ResourceHeadCell>
              <ResourceHeadCell className="w-[14%]">Protocol</ResourceHeadCell>
              <ResourceHeadCell className="w-[16%]">Created</ResourceHeadCell>
              <ResourceMenuHead className="w-[10%]" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {idps.length === 0 ? (
              <ResourceEmptyRow colSpan={6}>
                This project has no identity providers. Add one with{" "}
                <InlineCode>zitadel sso enable</InlineCode>.
              </ResourceEmptyRow>
            ) : (
              idps.map((idp) => <IdpRow key={idp.id} idp={idp} />)
            )}
          </TableBody>
        </Table>
      </div>
      <LoadMore paging={paging} />
    </>
  );
}

function IdpRow({ idp }: { idp: IdpConnection }) {
  const navigate = useNavigate();
  const name = idp.definition.display_name;

  return (
    <ResourceRow
      onOpen={() => void navigate({ to: "/authentication/idps/$idpId", params: { idpId: idp.id } })}
    >
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        <Link
          to="/authentication/idps/$idpId"
          params={{ idpId: idp.id }}
          className={RESOURCE_ROW_LINK}
        >
          <Shield aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
          {name}
        </Link>
      </TableCell>
      <TableCell className={`${RESOURCE_CELL} truncate`}>
        <InlineCode>{idp.slug}</InlineCode>
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{idp.definition.template ?? "—"}</TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>
        {idpProtocolLabel(idp.definition.protocol)}
      </TableCell>
      <TableCell className={RESOURCE_CELL_MUTED}>{formatDate(idp.created_at)}</TableCell>
      <TableCell className={`${RESOURCE_CELL} text-right`}>
        <RowMenu name={name}>
          <DropdownMenuItem asChild>
            <Link to="/authentication/idps/$idpId" params={{ idpId: idp.id }}>
              View connection
            </Link>
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </ResourceRow>
  );
}
