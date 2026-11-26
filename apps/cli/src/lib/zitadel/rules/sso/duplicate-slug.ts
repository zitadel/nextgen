import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

/**
 * Two connection files claim the same slug.
 *
 * @remarks
 * Why it matters: A slug names one connection, so the second file cannot be told apart from the
 * first and only the first, in path order, stands for it.
 *
 * Reported once: Only the second and later files are reported; the first file is the connection
 * every other rule reads.
 *
 * Fix: Change the slug in the file named, or delete one of the two files.
 *
 * Origin: #1703 (part of #1043), where the connection syncer's rules were joined to the SSO checks;
 * moved to the CLI by #2889; docs/design/idp/1-resource-model.md#validator-rules.
 */
export const DUPLICATE_SLUG: Rule = defineRule({
  id: "sso/duplicate-slug",
  severity: "error",
  each: (config) => {
    return config.connections.all.flatMap((connection) => {
      const first = config.connections.find(connection.slug);
      if (first === undefined || first === connection) {
        return [];
      }
      return [{ connection, slug: connection.slug, first }];
    });
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `connection slug ${quote(fact.slug)} is also used by ${fact.first.path}. A slug names one connection: change the slug here, or delete one of the two files.`;
  },
});
