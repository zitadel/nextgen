import type { Application } from "@/lib/zitadel/resources/applications/application";

/**
 * Name a client in a message about another client of `from`: by its slug,
 * and by its file too when that is another one.
 *
 * @param client - The client, and the application it belongs to.
 * @param from - The application of the client the message is about.
 * @returns `client "web"`, or `client "web" of .zitadel/applications/shop.json`.
 */
export function nameClient(
  client: { readonly application: Application; readonly client: string },
  from: Application,
): string {
  const named = `client ${JSON.stringify(client.client)}`;
  return client.application === from ? named : `${named} of ${client.application.path}`;
}
