/**
 * Where the Users screens' links lead. The project's Users list and a user's
 * detail open on the project's screens; the root's People draws the same
 * screens for the reserved platform project (D41), whose list, detail and
 * identity providers sit under Settings. Its schemas and teams have no root
 * page (D41 keeps them hidden), so the root leaves those targets out and each
 * reads as text, never as a link into a project screen.
 */
export interface UserLinks {
  /** The list a user is listed in, where a deleted user's detail returns to. */
  list: "/users" | "/platform/people";
  /** A user's detail, beside that list. */
  detail: "/users/$userId" | "/platform/people/$userId";
  /** An identity provider a user signs in with. */
  idp: "/authentication/idps/$idpId" | "/platform/authentication/idps/$idpId";
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

/** The root's People (D41): the platform project's users, and its Authentication. */
export const PEOPLE_USER_LINKS: UserLinks = {
  list: "/platform/people",
  detail: "/platform/people/$userId",
  idp: "/platform/authentication/idps/$idpId",
};
