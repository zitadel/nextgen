/**
 * Where the Users screens' links lead. The project's Users list and a user's
 * detail open on the project's screens; the root's Users draws the same
 * screens for the reserved platform project (D41). Its schemas, teams and
 * identity providers have no root page, so the root leaves those targets out
 * and each reads as text, never as a link into a project screen.
 */
export interface UserLinks {
  /** The list a user is listed in, where a deleted user's detail returns to. */
  list: "/users" | "/platform/users";
  /** A user's detail, beside that list. */
  detail: "/users/$userId" | "/platform/users/$userId";
  /** An identity provider's page; absent, a linked provider reads as text. */
  idp?: "/authentication/idps/$idpId";
  /** A schema revision's page; absent, the revision reads as text. */
  schema?: "/schemas/$schemaId";
  /** A team's page; absent, a membership reads as text. */
  team?: "/teams/$teamId";
}

/** The selected project's Users, its schemas, teams and providers beside it. */
export const PROJECT_USER_LINKS: UserLinks = {
  list: "/users",
  detail: "/users/$userId",
  idp: "/authentication/idps/$idpId",
  schema: "/schemas/$schemaId",
  team: "/teams/$teamId",
};

/** The root's Users (D41): the platform project's users, and nothing beside them. */
export const PLATFORM_USER_LINKS: UserLinks = {
  list: "/platform/users",
  detail: "/platform/users/$userId",
};
