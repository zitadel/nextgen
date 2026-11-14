import { payload, drawMapping } from "@/cli/commands/auth-method/sso/enable/shared";
import { escapeControlCharacters } from "@/lib/terminal-text";

import type { JsonEnvelope } from "@/lib/oclif";
import type { CredentialDelivery, PublishedCredentials } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";
import type { Connection, DocumentChange } from "@/lib/zitadel";

import type { Summary, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  summary: Summary;
  change: DocumentChange<Connection>;
  written: readonly string[];
  published: PublishedCredentials;
  delivery: CredentialDelivery;
}>;

/**
 * Words what the run did as the command's result.
 */
export class ShowResult extends WizardStep<
  "result",
  Readonly<{ answer: JsonEnvelope }>,
  Needs,
  EnableServices
> {
  readonly key = "result";

  /**
   * Build the result.
   *
   *
   * The result of a run that wrote the configuration and published the
   * credentials.
   * @param needs - What the run did.
   * @param services - What the command provides.
   * @returns The result the command answers with.
   */
  async run(needs: Needs, services: EnableServices): Promise<Readonly<{ answer: JsonEnvelope }>> {
    const summary = {
      summary: needs.summary,
      change: needs.change,
      written: needs.written,
      published: needs.published,
      delivery: needs.delivery,
    }.summary;
    const name = summary.displayName;
    const recovery = {
      summary: needs.summary,
      change: needs.change,
      written: needs.written,
      published: needs.published,
      delivery: needs.delivery,
    }.delivery
      .unpublishedOf(
        {
          summary: needs.summary,
          change: needs.change,
          written: needs.written,
          published: needs.published,
          delivery: needs.delivery,
        }.published,
      )
      .map((missing) => {
        return services.suggest({
          id: "variable:set",
          args: { name: missing.name },
          flags: { secret: missing.secret },
        });
      });
    const unpublished =
      !summary.reused ||
      {
        summary: needs.summary,
        change: needs.change,
        written: needs.written,
        published: needs.published,
        delivery: needs.delivery,
      }.written.length > 0;
    const stored = {
      summary: needs.summary,
      change: needs.change,
      written: needs.written,
      published: needs.published,
      delivery: needs.delivery,
    }.delivery.areStored(
      {
        summary: needs.summary,
        change: needs.change,
        written: needs.written,
        published: needs.published,
        delivery: needs.delivery,
      }.published,
    );
    const followUps = services.followUps(unpublished, recovery);
    const data = payload({
      summary,
      change: {
        summary: needs.summary,
        change: needs.change,
        written: needs.written,
        published: needs.published,
        delivery: needs.delivery,
      }.change,
      published: {
        summary: needs.summary,
        change: needs.change,
        written: needs.written,
        published: needs.published,
        delivery: needs.delivery,
      }.published,
      names: {
        summary: needs.summary,
        change: needs.change,
        written: needs.written,
        published: needs.published,
        delivery: needs.delivery,
      }.delivery.names,
    });

    if (!services.isJson) {
      drawMapping(
        {
          summary: needs.summary,
          change: needs.change,
          written: needs.written,
          published: needs.published,
          delivery: needs.delivery,
        }.change,
      );
    }

    const title = this.title(name, unpublished);

    return {
      answer: await services.emit({
        status: "ok",
        data: {
          title,
          ...data,
          next_args: followUps.args,
        },
        summary: {
          title: escapeControlCharacters(title),
          sections: [],
          lines: unpublished && stored ? ["Its credentials are stored in your project."] : [],
        },
        next: unpublished
          ? {
              actions: [
                `Deploy it to make ${name} sign-in available in your app, then reload the app and test it`,
              ],
              commands: followUps.commands,
            }
          : { commands: followUps.commands },
      }),
    };
  }

  /**
   * The result's title: whether the provider is configured. The terminal and
   * the envelope say it in these same words.
   *
   * @param name - The provider's display name.
   * @param unpublished - Whether the configuration has changes to deploy.
   * @returns The title.
   */
  private title(name: string, unpublished: boolean): string {
    if (!unpublished) {
      return `${name} sign-in is already configured locally`;
    }
    return `${name} sign-in is configured locally`;
  }
}

/**
 * What `result` words the result from.
 */
type ResultInput = {
  readonly summary: Summary;
  readonly change: DocumentChange<Connection>;
  readonly written: readonly string[];
  readonly published: PublishedCredentials;
  readonly delivery: CredentialDelivery;
};
