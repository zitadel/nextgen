import type { ConnectedZitadel } from "@zitadel/testing/playwright";

/**
 * What the specs arrange through the API, from the test process, with the
 * connection's typed client (`zitadel.api`). That client holds the
 * boot-captured project secret, which the browser must not see (the
 * credential-leak spec in `src-real/console-real.spec.ts`).
 */

/**
 * Makes a seeded user an admin of the instance's project.
 *
 * A seeded user can sign in to the console but holds no grant, and the console
 * lists only the projects a person can act on (`GET /users/me/projects`,
 * #1237) — so without this the project pill and the Projects screen are
 * honestly empty. The grant is the same one a project's admins section creates.
 */
export async function grantProjectAdmin(zitadel: ConnectedZitadel, userId: string): Promise<void> {
  await withErrorBody(
    zitadel.api.createGrant(
      { user: { user_id: userId }, relation: "admin" },
      { project_id: zitadel.handle.projectId },
    ),
  );
}

/**
 * Writes an identity provider connection to the instance's project. Writes
 * stay secret-only (#998), so a spec arranges one here rather than through the
 * read-only screen. The same slug again appends a revision, so a retried or
 * parallel test reuses the connection instead of failing on it.
 */
export async function createIdpConnection(
  zitadel: ConnectedZitadel,
  idp: { slug: string; display_name: string; template?: string },
): Promise<{ id: string }> {
  return withErrorBody(
    zitadel.api.createIdp(
      {
        idp: {
          ...idp,
          protocol: "oidc",
          oidc: {
            issuer: "https://accounts.google.com",
            client_id: "${{ E2E_CLIENT_ID }}",
            client_secret: "${{ E2E_CLIENT_SECRET }}",
            scopes: ["openid", "profile", "email"],
          },
        },
      },
      { project_id: zitadel.handle.projectId },
    ),
  );
}

/**
 * Awaits a call on `zitadel.api` and keeps the server's answer in a failure.
 * The client's `ApiError` message is only "POST … returned 409"; the body,
 * which says why, is a property the test report does not print.
 */
export async function withErrorBody<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof Error && "body" in error) {
      throw new Error(`${error.message}: ${JSON.stringify(error.body)}`, { cause: error });
    }
    throw error;
  }
}
